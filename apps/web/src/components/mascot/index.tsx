import { cn } from "@workspace/ui/lib/utils";

// Agents' pixel mascots, BB's: 8x8 sprites from MonoCode (MIT, see LICENSE
// beside this file), drawn in the agent's name color on its avatar.
export const mascots = [
  "invader",
  "ghost",
  "robot",
  "cat",
  "skull",
  "crab",
  "mushroom",
  "rocket",
  "dino",
  "frog",
] as const;

export type Mascot = (typeof mascots)[number];

const sprites: Record<Mascot, readonly string[]> = {
  invader: [
    "..#..#..",
    ".######.",
    "##.##.##",
    "########",
    ".######.",
    ".#.##.#.",
    "#.#..#.#",
    "........",
  ],
  ghost: [
    "..####..",
    ".######.",
    "##.##.##",
    "########",
    "########",
    "########",
    "########",
    "#.##.##.",
  ],
  robot: [
    "...#....",
    ".######.",
    ".#.##.#.",
    ".######.",
    ".#....#.",
    ".######.",
    "..#..#..",
    "........",
  ],
  cat: [
    ".#....#.",
    ".##..##.",
    "########",
    "#.####.#",
    "########",
    "###..###",
    ".######.",
    "..#..#..",
  ],
  skull: [
    ".######.",
    "########",
    "##.##.##",
    "########",
    ".##..##.",
    ".######.",
    ".#.##.#.",
    "........",
  ],
  crab: [
    "#......#",
    ".#....#.",
    ".######.",
    "##.##.##",
    "########",
    "#.####.#",
    "#......#",
    "........",
  ],
  mushroom: [
    "..####..",
    ".######.",
    "########",
    "##.##.##",
    "########",
    "...##...",
    "...##...",
    "..####..",
  ],
  rocket: [
    "...##...",
    "..####..",
    "..#..#..",
    "..####..",
    ".######.",
    ".######.",
    "##....##",
    "..####..",
  ],
  dino: [
    "...#####",
    "...##.##",
    "...#####",
    ".#######",
    "########",
    "#####...",
    ".##.##..",
    "..#..#..",
  ],
  frog: [
    "........",
    "##....##",
    "#.####.#",
    "########",
    "########",
    ".######.",
    "##....##",
    "........",
  ],
};

// One square per run of "#" in a row, as a single path.
function pathOf(rows: readonly string[]) {
  let path = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "#") {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run] === "#") run += 1;
      path += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return path;
}

const paths = Object.fromEntries(
  mascots.map((name) => [name, pathOf(sprites[name])]),
) as Record<Mascot, string>;

// Sized by its slot (an avatar sizes its icon), colored by `currentColor`.
export function MascotIcon({
  mascot,
  className,
}: {
  mascot: Mascot;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      fill="currentColor"
      className={cn("shrink-0", className)}
    >
      <path d={paths[mascot]} />
    </svg>
  );
}
