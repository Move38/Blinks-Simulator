var BLOCK_RADIUS = 24;

var engine;
var mouseConstraints;
var curr_dragging;
var target_shadow; 
var blocks = [];

function setup() {
    var canvas = createCanvas(windowWidth, windowHeight);

    // setup matter
    engine = Matter.Engine.create();
    engine.world.gravity.y = 0;
    engine.world.gravity.scale = 0;
    Matter.Engine.run(engine);

    // add hexgons
    blocks.push(generateBlock(width/2, height/2, BLOCK_RADIUS * 2));
    blocks.push(generateBlock(width/2, height/2, BLOCK_RADIUS * 2));
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
    mouseConstraints =  Matter.MouseConstraint.create(engine, {
        mouse: mouse
    });
    mouse.pixelRatio = pixelDensity();
    Matter.World.add(
        engine.world,
        mouseConstraints
    );
    
    Matter.Events.on(mouseConstraints, 'startdrag', function(){
        curr_dragging = mouseConstraints.body;
        startDrag();
    });
    Matter.Events.on(mouseConstraints, 'mousemove', function(){
        if(curr_dragging){
            duringDrag();
        }
    });
    Matter.Events.on(mouseConstraints, 'enddrag', function(){
        endDrag();
        curr_dragging = null;
    });
}

function draw() {
    background(0);  
    drawTargetShadow();
    drawBlocks();
}

function generateBlock(x, y, s){
    var block = Matter.Bodies.polygon(x, y, 6, s, { 
        friction: 0.8,
        frictionAir: 0.8,
        inertia: Infinity, //disable rotation
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
        noStroke();
        fill(255, 240);
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

// Events
function startDrag(){
    // console.log('start drag', curr_dragging);
}

function duringDrag(){
    // console.log('during drag', curr_dragging);
    checkLocations();
}

function endDrag(){
    // console.log('end drag', curr_dragging);
    if(target_shadow){
        Matter.Body.setPosition(curr_dragging, {
            x: target_shadow.body.position.x + target_shadow.offset.x,
            y: target_shadow.body.position.y + target_shadow.offset.y
        })
        clearTargetShadow();
    }
}

function checkLocations(){
    for(var i=0; i<blocks.length; i++){
        var one = blocks[i];
        if(one.id !== curr_dragging.id){
            var d = dist(curr_dragging.position.x, curr_dragging.position.y, one.position.x, one.position.y);
            if(d < BLOCK_RADIUS * 5) {
                // draw target location
                var angleDeg = degrees(atan2(curr_dragging.position.y - one.position.y, curr_dragging.position.x - one.position.x));
                var targetDeg = int(((angleDeg + 360 + 30) % 360) / 60);
                updateTargetShadow(one, targetDeg);
            }
            else {
                clearTargetShadow();
            }
        }
    }
}

function clearTargetShadow() {
    target_shadow = null;
}

function updateTargetShadow(body, deg){
    var offsetX = cos(radians(deg * 60)) * BLOCK_RADIUS * 3.3334;
    var offsetY = sin(radians(deg * 60)) * BLOCK_RADIUS * 3.3334;
    // console.log('draw target location', body, deg, offsetX, offsetY);
    target_shadow = {
        body: body,
        offset: {
            x: offsetX,
            y: offsetY
        },
        vertices: []
    }
    for(var i=0; i<body.vertices.length; i++ ){
        var ver = body.vertices[i];
        target_shadow.vertices.push({
            x: ver.x + offsetX,
            y: ver.y + offsetY
        })
    }
}

function drawTargetShadow(){
    if(!target_shadow) return;
    noStroke();
    fill(60);
    beginShape();
    for(var i=0; i<target_shadow.vertices.length; i++ ){
        var ver = target_shadow.vertices[i];
        vertex(ver.x, ver.y);
    }
    endShape(CLOSE);
}