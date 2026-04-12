function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '').padEnd(6, '0');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate `count` visually distinct shades of `baseHex`, ordered light → dark.
 * With count=1 the base color is returned unchanged.
 * With count=6 the range spans ~60% tint (light) through ~50% shade (dark).
 */
export function generateColorShades(baseHex: string, count: number): string[] {
  if (count <= 1) return [baseHex];
  const [r, g, b] = hexToRgb(baseHex);
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1); // 0 = lightest, 1 = darkest
    let nr: number, ng: number, nb: number;
    if (t <= 0.5) {
      const blend = (0.5 - t) * 1.2; // up to ~60% white
      nr = r + (255 - r) * blend;
      ng = g + (255 - g) * blend;
      nb = b + (255 - b) * blend;
    } else {
      const blend = (t - 0.5) * 1.0; // up to ~50% black
      nr = r * (1 - blend);
      ng = g * (1 - blend);
      nb = b * (1 - blend);
    }
    return rgbToHex(nr, ng, nb);
  });
}

/**
 * Returns the category-shaded color for an exercise given its position among
 * all tracked exercises in the same category.
 *
 * Exercises are shaded light → dark in the order they appear in `allTracked`.
 * If the exercise is the only one in its category, its base color is returned.
 */
export function getExerciseCategoryShade(
  exerciseId: string,
  exerciseColor: string,
  exerciseCategory: string,
  allTracked: Array<{ exercise: { id: string; color: string; category: string } }>,
): string {
  const group = allTracked.filter(te => te.exercise.category === exerciseCategory);
  if (group.length <= 1) return exerciseColor;
  const idx = group.findIndex(te => te.exercise.id === exerciseId);
  if (idx === -1) return exerciseColor;
  // Use the first exercise's color in the group as the shared base so all
  // members get distinct shades of the same hue rather than similar-looking
  // shades of subtly different base colors.
  const baseColor = group[0].exercise.color;
  return generateColorShades(baseColor, group.length)[idx];
}
