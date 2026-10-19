import { strict as assert } from "node:assert";
import { demonstrationFrame, DEMO_DURATION } from "../src/lib/greenhouse-demo";

assert.equal(demonstrationFrame(0).valveOpening, 0);
assert.equal(demonstrationFrame(1.5).valveOpening, 1);
assert.equal(demonstrationFrame(2.99).flowing, false);
assert.equal(demonstrationFrame(3).flowing, true);
assert.equal(demonstrationFrame(13).flowing, false);
assert.equal(demonstrationFrame(14.5).valveOpening, 0);
assert.deepEqual(demonstrationFrame(DEMO_DURATION), demonstrationFrame(0));
assert.deepEqual(demonstrationFrame(-1), demonstrationFrame(0));
console.log("Demonstration timing: 8 checks passed");
