// Fable51Kart multiplayer room — the Fable Kart relay DO with EIGHT seats.
//
// Same lobby + opaque star-topology relay as Kart3Room (client `input` →
// host; host `snap`/`event` → everyone; `rtc` peer signaling; `pp` RTT
// echo; mid-race rejoin by name). It lives in its OWN Durable Object
// namespace so Fable Kart rooms and Fable51Kart rooms can never collide on a
// code, and so the two games' version gates stay independent.
import { Kart3Room } from "./kart3room";

const MAX_PLAYERS_51 = 8;

export class Fable51Room extends Kart3Room {
  protected maxPlayers(): number { return MAX_PLAYERS_51; }
}
