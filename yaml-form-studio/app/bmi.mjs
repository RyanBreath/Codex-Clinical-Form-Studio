/**
 * Calculate BMI from centimetres and kilograms and return a display value that
 * preserves the requested number of decimal places.
 *
 * @param {unknown} heightCm
 * @param {unknown} weightKg
 * @param {number} [decimalPlaces=2]
 * @returns {string}
 */
export function calculateBmi(heightCm, weightKg, decimalPlaces = 2) {
  const height = Number(heightCm);
  const weight = Number(weightKg);
  const precision = Number.isInteger(decimalPlaces) && decimalPlaces >= 0 && decimalPlaces <= 10
    ? decimalPlaces
    : 2;

  if (!Number.isFinite(height) || !Number.isFinite(weight) || height <= 0 || weight <= 0) return "";

  const heightMetres = height / 100;
  const bmi = weight / (heightMetres * heightMetres);
  const scale = 10 ** precision;
  const rounded = Math.round((bmi + Number.EPSILON) * scale) / scale;
  return rounded.toFixed(precision);
}
