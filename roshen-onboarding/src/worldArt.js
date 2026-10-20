import world1 from '../assets/worlds/world1.webp';
import world2 from '../assets/worlds/world2.webp';
import world3 from '../assets/worlds/world3.webp';
import world4 from '../assets/worlds/world4.webp';
import world5 from '../assets/worlds/world5.webp';
import world6 from '../assets/worlds/world6.webp';

/** Portrait episode art. w0 is preboarding, w5 is day 90. */
export const WORLD_ART = {
  w0: world1,
  w1: world2,
  w2: world3,
  w3: world4,
  w4: world5,
  w5: world6,
};

export function worldArtFor(worldId) {
  return WORLD_ART[worldId] || world1;
}
