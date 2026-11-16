# Cura canvas performance stress run

Measured 200 synthetic products in an isolated Chromium context at 1440 × 900. Before and after runs used the same local SVG fixtures, 48 pointer steps per gesture, and the same Playwright harness. The fixture had no product URLs and did not touch the user's saved canvas or invoke product resolution.

| Gesture | Measure | Before | After |
| --- | --- | ---: | ---: |
| Pan | Playwright input-loop time | 5,690 ms | 2,006 ms |
| Pan | RAF gaps over 32 ms | 19 | 3 |
| Pan | RAF gap p95 | 116.7 ms | 16.8 ms |
| Pan | Long tasks | 16 | 3 |
| Pan | Longest single long task | 255 ms | 231 ms |
| Product drag | Playwright input-loop time | 5,908 ms | 1,784 ms |
| Product drag | RAF gaps over 32 ms | 20 | 3 |
| Product drag | RAF gap p95 | 200 ms | 16.8 ms |
| Product drag | Long tasks | 18 | 2 |
| Product drag | Longest single long task | 270 ms | 239 ms |
| Both | Layout shifts / CLS | 0 / 0 | 0 / 0 |

The input-loop time is the wall time to deliver the 48 Playwright pointer steps, so it includes browser automation overhead. RAF gaps and Long Task API entries are browser-side measurements. They show much fewer stalls during pan and product dragging, and the longest observed task also fell in both runs. RAF gap counts are a stutter proxy; this run did not include a human visual rating.

The runner is `node scratch/canvas-performance-stress.mjs`. Raw results are in `canvas-performance-before.json` and `canvas-performance-after.json` beside this report.
