import assert from "node:assert/strict";
import test from "node:test";

import { calculateBmi } from "../app/bmi.mjs";

test("BMI is calculated from centimetres and kilograms to two decimals", () => {
  assert.equal(calculateBmi(170, 70, 2), "24.22");
});

test("BMI retains two display decimals", () => {
  assert.equal(calculateBmi(200, 80, 2), "20.00");
});

test("BMI remains blank until positive height and weight are present", () => {
  assert.equal(calculateBmi("", 70, 2), "");
  assert.equal(calculateBmi(170, 0, 2), "");
});
