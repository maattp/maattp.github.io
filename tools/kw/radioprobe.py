"""Listen to radio streams: what tools/kw/radiotest.mjs calls for the content half.

    python radioprobe.py <secs> <url> [url ...]   -> one JSON object per line

For each stream: capture <secs> s as the browser would get it (curl following
redirects with a Safari user agent and an Origin header, piped to ffmpeg; HLS
straight into ffmpeg), then measure
  lufs     integrated loudness (ffmpeg ebur128)
  silent   % of 100 ms windows under -50 dBFS
  repeat   best correlation of the first 8 s against any later 8 s of a
           band-energy fingerprint: a short message on a loop scores ~0.8-1
           (but so can a four-on-the-floor tune: read it with the transcript)
  text     a whisper transcript of 15 s near the start and 15 s at the end,
           when faster-whisper is importable (pip install faster-whisper; the
           first run downloads the 'base' model). That is what catches "the
           stream you are trying to access is not available at this time".
Needs numpy and /opt/homebrew/bin/ffmpeg (or $FFMPEG).
"""
import json, os, re, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np

FF = os.environ.get('FFMPEG', '/opt/homebrew/bin/ffmpeg')
UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
SR = 16000


def capture(url, secs, wav):
    if '.m3u8' in url:
        cmd = [FF, '-hide_banner', '-loglevel', 'error', '-y', '-user_agent', UA,
               '-headers', 'Origin: https://polkiewicz.com\r\n', '-rw_timeout', '15000000',
               '-i', url, '-t', str(secs), '-vn', '-ac', '1', '-ar', str(SR), wav]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=secs + 60)
        return r.stderr.strip()[-200:]
    curl = subprocess.Popen(['curl', '-s', '-L', '-m', str(secs + 25), '-A', UA,
                             '-H', 'Origin: https://polkiewicz.com', url], stdout=subprocess.PIPE)
    r = subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', 'pipe:0', '-t', str(secs),
                        '-vn', '-ac', '1', '-ar', str(SR), wav],
                       stdin=curl.stdout, capture_output=True, text=True, timeout=secs + 60)
    curl.kill()
    return r.stderr.strip()[-200:]


def lufs(wav):
    r = subprocess.run([FF, '-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128', '-f', 'null', '-'],
                       capture_output=True, text=True)
    m = re.findall(r'I:\s+(-?[\d.]+|-inf) LUFS', r.stderr)
    return float(m[-1]) if m and m[-1] != '-inf' else -99.0


def measure(x):
    hop = SR // 10
    n = len(x) // hop
    fr = x[:n * hop].reshape(n, hop)
    db = 10 * np.log10(np.mean(fr ** 2, axis=1) + 1e-12)
    silent = float(np.mean(db < -50)) * 100
    spec = np.abs(np.fft.rfft(fr * np.hanning(hop), axis=1))
    f = np.fft.rfftfreq(hop, 1 / SR)
    edges = np.geomspace(100, 7000, 17)
    bands = np.stack([spec[:, (f >= a) & (f < b)].sum(1) for a, b in zip(edges[:-1], edges[1:])], 1)
    fp = np.log(bands + 1e-6)
    fp = fp - fp.mean(1, keepdims=True)
    W, best = 80, 0.0
    if n > 2 * W + 20:
        a = fp[:W].ravel(); a = (a - a.mean()) / (a.std() + 1e-9)
        for lag in range(W + 10, n - W):
            b = fp[lag:lag + W].ravel(); b = (b - b.mean()) / (b.std() + 1e-9)
            best = max(best, float(np.dot(a, b) / len(a)))
    return round(silent, 1), round(best, 2)


def main():
    secs, urls = float(sys.argv[1]), sys.argv[2:]
    tmp = tempfile.mkdtemp(prefix='radioprobe-')
    wavs = [os.path.join(tmp, f'{i}.wav') for i in range(len(urls))]
    with ThreadPoolExecutor(8) as ex:
        errs = list(ex.map(lambda a: capture(a[0], secs, a[1]), zip(urls, wavs)))
    model = None
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel('base', device='cpu', compute_type='int8')
    except Exception:
        pass
    for url, wav, err in zip(urls, wavs, errs):
        d = {'url': url, 'secs': 0, 'lufs': None, 'silent': None, 'repeat': None, 'text': None, 'err': err}
        if os.path.exists(wav) and os.path.getsize(wav) > 10000:
            x = np.fromfile(wav, dtype='<i2', offset=44).astype(np.float32) / 32768
            d['secs'] = round(len(x) / SR, 1)
            d['silent'], d['repeat'] = measure(x)
            d['lufs'] = lufs(wav)
            if model is not None:
                txt = []
                for start in (2, max(2, d['secs'] - 17)):
                    seg = x[int(start * SR):int((start + 15) * SR)]
                    s, _ = model.transcribe(seg, beam_size=1)
                    txt.append(' '.join(t.text.strip() for t in s))
                d['text'] = ' | '.join(txt)
        try:
            os.remove(wav)
        except OSError:
            pass
        print(json.dumps(d), flush=True)


if __name__ == '__main__':
    main()
