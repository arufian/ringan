import { ringan } from "ringan";

function heavyProcessFunction(items: number[]) {
  let total = 0;
  for (let index = 0; index < items.length; index += 1) {
    total += Math.sqrt(items[index] ?? 0);
  }
  return total;
}

const run = ringan(heavyProcessFunction);
const result = await run(Array.from({ length: 100_000 }, (_, index) => index));

console.log(result);
