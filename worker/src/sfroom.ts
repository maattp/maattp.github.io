// Space Flight multiplayer room — the Fable Kart relay DO with EIGHT seats.
//
// Same lobby + opaque star-topology relay as Kart3Room (client `input` →
// host; host `snap`/`event` → everyone; `rtc` peer signaling; `pp` RTT
// echo). Own Durable Object namespace so Space Flight rooms never collide
// with the kart games' codes and the version gate stays independent.
// There is deliberately no host migration: when the host leaves, the room
// tells everyone and the race dies.
import { Kart3Room } from "./kart3room";

const MAX_PLAYERS_SF = 8;

export class SpaceRoom extends Kart3Room {
  protected maxPlayers(): number { return MAX_PLAYERS_SF; }
}
