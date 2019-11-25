var engine;
var blocks = [];

function setup() {
    var canvas = createCanvas(windowWidth, windowHeight);

    // setup matter
    engine = Matter.Engine.create();
    engine.world.gravity.y = 0;
    engine.world.gravity.scale = 0;
    Matter.Engine.run(engine);

    // add hexgons
    blocks.push(generateBlock(width/2 - 24, height/2, 48));
    blocks.push(generateBlock(width/2 + 24, height/2, 48));
    console.log(blocks[0]);

    // add walls
    Matter.World.add(engine.world, [
        Matter.Bodies.rectangle(windowWidth/2, -20, windowWidth, 40, { isStatic: true }), //top
        Matter.Bodies.rectangle(windowWidth/2, windowHeight + 20, windowWidth, 40, { isStatic: true }), //bottom
        Matter.Bodies.rectangle(windowWidth + 20, windowHeight/2, 40, windowHeight, { isStatic: true }), //right
        Matter.Bodies.rectangle(-20, windowHeight/2, 40, windowHeight, { isStatic: true }) //left
    ]);

    // add mouse interaction
    var mouse = Matter.Mouse.create(canvas.elt);
    mouse.pixelRatio = pixelDensity();
    Matter.World.add(
        engine.world,
        Matter.MouseConstraint.create(engine, {
            mouse: mouse
        })
    );
}

function draw() {
    background(0);  
    drawBlocks();
}

function generateBlock(x, y, s){
    var block = Matter.Bodies.polygon(x, y, 6, s, { 
        friction: 0.8,
        frictionAir: 0.8,
        chamfer: {
            radius: 10 //rounded corner
        }
    });
    Matter.World.addBody(engine.world, block);
    return block;
}

function drawBlocks(){
    for(var i=0; i<blocks.length; i++){
        var one = blocks[i];
        // draw stroke
        stroke(255);
        noFill();
        beginShape();
        for(var j=0; j<one.vertices.length; j++ ){
            var ver = one.vertices[j];
            vertex(ver.x, ver.y);
        }
        endShape(CLOSE);
        
        // draw angle indicator
        stroke(255, 0, 0);
        line(one.position.x, 
            one.position.y, 
            one.vertices[0].x/2 + one.vertices[one.vertices.length-1].x/2, 
            one.vertices[0].y/2 + one.vertices[one.vertices.length-1].y/2);
    }
}
