# Blinks-Simulator
This simulator is using PIXIJS as rendering engine and MatterJS as physics engine. The core library file is `build/blinks.min.js`
[Demo](https://move38.github.io/Blinks-Simulator/)


## Build
run `npm run install` to install packages
run `npm run build` to build blinks library
run `npm run dev` to start examples in a local server

## Usage
Use mouse to drag the blocks around to reposition them. Click and drag on an empty space to create a ribbon, when ribbon go through the blocks, it will break them into different groups, when you move groups around you will rejoin them when one get close to another.

## Namespace
All functions are isolated by the namespace, you can declare a global namespace, and use all the functions directly.

```js
new BLINKS("global"); //initialize Blinks
resizeCanvas(800, 640);
createBlocks(6)
for (let i = 0; i < 6; i++) {
    setColor(i, YELLOW)
    setColorOnFace(i, Math.floor(Math.random() * 6), CYAN)
}
```
Alternatively you can create a namespace and call all the functions under that
```js
const blk = new BLINKS(); //initialize Blinks
blk.resizeCanvas(800, 640);
blk.createBlocks(6)
for (let i = 0; i < 6; i++) {
    blk.setColor(i, blk.YELLOW)
    blk.setColorOnFace(i, Math.floor(Math.random() * 6), blk.CYAN)
}
```
It also support multiple instances in one single page
```js
const blk01 = new BLINKS(); //initialize Blinks
blk01.resizeCanvas(400, 300);
blk01.createBlocks(4)
for (let i = 0; i < 4; i++) {
    blk01.setColor(i, blk01.YELLOW)
    blk01.setColorOnFace(i, Math.floor(Math.random() * 6), blk01.CYAN)
}
const blk02 = new BLINKS(); //initialize Blinks
blk02.resizeCanvas(400, 300);
blk02.createBlocks(4)
for (let i = 0; i < 4; i++) {
    blk02.setColors(i,  Array.from({ length: 6 }, () => Array.from({ length: 3 }, () => Math.random() > 0.2 ? 0.0 : 1.0)))
}
```