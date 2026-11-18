# Baking the textured crewman

`public/models/crewman/crewman.glb` and `crewman-crew-mask.png` (the crewmate's body, F6.3b, [docs/crew-avatars.md](../../docs/crew-avatars.md)) are made by this folder from Quaternius's **Universal Base Characters [Standard]**, which are CC0 (public domain): <https://quaternius.itch.io/universal-base-characters>. The source files are not kept in the repository (about 30 MB of textures).

To bake again, for instance after changing the uniform's colours or the beret's fit in `bake.ts`:

1. Download the Standard pack and copy these from it into `scripts/crewman-bake/source/` (the folder is git-ignored): `Superhero_Male_FullBody.gltf`, `Superhero_Male_FullBody.bin`, `T_Superhero_Male_Ligh.png`, `T_Eye_Brown.png`, `T_Hair_1_BaseColor.png` and the other textures the `.gltf` names (missing normal maps only log a warning; they are dropped).
2. Serve the page: `npx vite --config scripts/crewman-bake/vite.config.mjs`.
3. Bake: `node scripts/crewman-bake/export.mjs`. It writes the two files into `public/models/crewman/` and prints the headgear's triangle count.
4. Run `npm test` (`test/crewman.test.ts` checks the model's size and bones, `test/z-fighting.test.ts` its headgear) and look at the crewmate in the game.

What `bake.ts` does:

- **Uniform.** Paints the skin texture in UV space on the GPU: each texel is coloured by where it sits on the body in the bind pose and which bones move it (head, hands, feet, torso, arms, legs). Khaki denim overalls, a brown leather jerkin, a khaki collar, a neckerchief, a webbing belt, webbing anklets, black boots, and a short back and sides under the beret. The cloth keeps the original texture's light and shade. The texture is dilated past its islands' edges and saved at 1024 pixels as a JPEG.
- **Crew colour.** The neckerchief is painted mid grey and a 512-pixel mask marks it; the game tints it with the crew colour (`Crewman` in `src/scene-assets/crewman.ts`).
- **Headgear.** The beret's band is the head's own skin pushed out 6 mm above a band line, so it hugs the head; a flattened crown sits on it, pulled down over the right ear; a badge on the band over the left eye; a headset band over the crown and earphones on the ears. All merged into one vertex-coloured mesh named `Headgear`, in the model's space.
- **Trim.** Drops the hair, the normal, roughness and metalness maps, and the extra UV and colour sets; shrinks the eye and eyebrow textures to 256 pixels.
