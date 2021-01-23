# Blinks-Simulator
An online editor to preview games that developped in Blinks systems. [Demo](https://move38.github.io/Blinks-Simulator/)
- Live edit C++ code powered by [Code Mirror](https://codemirror.net/)
- Auto compile C++ code into javascript with custom parser
- Each blink tile is running in its own thread using WebWorker
- LED lighting simulates in shader with [PixiJS](https://www.pixijs.com/)
- Physics engine powered by [MatterJS](https://brm.io/matter-js/) (using custom build with fernandez's decomp library for better convex & concave support)

## Start
- `npm install` to install packages
- `npm run build` to build blinks.js library
- `npm run dev` to start a local dev server

## Usage
- Click and drag blinks to re-arrange them. 
- Click and drag in an open space to break them.
- You can use console for debugging info

## Files
- `build/blinks.js` core library to handle user interaction and simulation using PixiJS & MatterJS
- `examples/js/app.js` main js file to run the demo
- `examples/js/blinks.js` simulates functions of a single blink tile
- `examples/js/parse.js` custom parser to compile C++ Arduino code into Javascript

## Blinks.js
`build/blinks.js` can be used independently to interact and display blinks, it has its own namespace, and supports multiple instances on a single page

```js
new BLINKS("global"); //with global namespace
resizeCanvas(800, 640);
createBlocks(6)
for (let i = 0; i < 6; i++) {
    setColor(i, YELLOW)
    setColorOnFace(i, Math.floor(Math.random() * 6), CYAN)
}
```
Alternatively you can create a custom namespace
```js
const blk = new BLINKS();
blk.resizeCanvas(800, 640);
blk.createBlocks(6)
for (let i = 0; i < 6; i++) {
    blk.setColor(i, blk.YELLOW)
    blk.setColorOnFace(i, Math.floor(Math.random() * 6), blk.CYAN)
}
```
It also support multiple instances in one single page
```js
const blk01 = new BLINKS();
blk01.resizeCanvas(400, 300);
blk01.createBlocks(4)
for (let i = 0; i < 4; i++) {
    blk01.setColor(i, blk01.YELLOW)
    blk01.setColorOnFace(i, Math.floor(Math.random() * 6), blk01.CYAN)
}
const blk02 = new BLINKS();
blk02.resizeCanvas(400, 300);
blk02.createBlocks(4)
for (let i = 0; i < 4; i++) {
    blk02.setColors(i,  Array.from({ length: 6 }, () => Array.from({ length: 3 }, () => Math.random() > 0.2 ? 0.0 : 1.0)))
}
```
