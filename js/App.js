var BLOCK_RADIUS = 24;
var TOTAL_BLOCK = 6;

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
    for(var i = 0; i < TOTAL_BLOCK; i ++){
        // generate a new block and keep them centered
        var alt = i % 2 * 2 - 1; // -1 or 1
        var block = generateBlock(width/2 + (i - TOTAL_BLOCK/2)*BLOCK_RADIUS * 1.732, height/2 + alt*BLOCK_RADIUS*1.5, BLOCK_RADIUS * 2);
        blocks.push(block);
    }
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
        // inertia: Infinity, //enable rotation
    });
    Matter.World.addBody(engine.world, block);
    return block;
}

function drawBlocks(){
    for(var i=0; i<blocks.length; i++){
        var one = blocks[i];
        // update round radius
        var vertices = Matter.Vertices.chamfer(one.vertices, 10, -1, 2, 14); //default chamfer
        // draw block
        noStroke();
        fill(255, 240);
        beginShape();
        for(var j=0; j<vertices.length; j++ ){
            var ver = vertices[j];
            vertex(ver.x, ver.y);
        }
        endShape(CLOSE);

        // draw angle indicator
        var midPoint = {
            x: one.vertices[0].x/2 + one.vertices[one.vertices.length-1].x/2, 
            y: one.vertices[0].y/2 + one.vertices[one.vertices.length-1].y/2
        }
        stroke(255, 0, 0);
        line(one.position.x, 
            one.position.y, 
            one.position.x + (midPoint.x - one.position.x) * 0.88,
            one.position.y + (midPoint.y - one.position.y) * 0.88
        );
            
        // draw axes
        noStroke();
        fill(0, 0, 255);
        beginShape();
        for(var k=0; k<one.axes.length; k++ ){
            var ver = one.axes[k];
            vertex(ver.x, ver.y);
        }
        endShape(CLOSE);
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
        // limit to 0 to 60
        var angleDiff = degrees(target_shadow.body.angle - curr_dragging.angle + PI * 2) % 60
        // update to -30 to 30 for minimal rotation
        angleDiff = angleDiff > 30 ? angleDiff - 60 : angleDiff;
        var angle = (curr_dragging.angle + radians(angleDiff))
        Matter.Body.setAngle(curr_dragging, angle);
        clearTargetShadow();
    }
}

function checkLocations(){
    for(var i=0; i<blocks.length; i++){
        var one = blocks[i];
        if(one.id !== curr_dragging.id){
            var d = dist(curr_dragging.position.x, curr_dragging.position.y, one.position.x, one.position.y);
            if(d < BLOCK_RADIUS * 5) {
                var p1 = [one.position.x, one.position.y];
                var p2 = [curr_dragging.position.x, curr_dragging.position.y];
                var pInter;
                for(var j=0; j<=one.vertices.length; j++){
                    var vert1 = one.vertices[j];
                    var vert2 = one.vertices[(j + 1) % 6];
                    var q1 = [vert1.x, vert1.y];
                    var q2 = [vert2.x, vert2.y];
                    var lineIntersect = decomp.lineSegmentsIntersect(p1, p2, q1, q2);
                    if(lineIntersect){
                        pInter = {
                            x: (vert1.x + vert2.x) / 2,
                            y: (vert1.y + vert2.y) / 2
                        }
                        break;
                    }
                }
                updateTargetShadow(one, pInter);
                break;
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

function updateTargetShadow(body, p){
    var offsetX = (p.x - body.position.x) * 2;
    var offsetY = (p.y - body.position.y) * 2;
    // console.log('draw target location', body, p, offsetX, offsetY);
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
    // update round radius
    var vertices = Matter.Vertices.chamfer(target_shadow.vertices, 10, -1, 2, 14); //default chamfer
    noStroke();
    fill(60);
    beginShape();
    for(var i=0; i<vertices.length; i++ ){
        var ver = vertices[i];
        vertex(ver.x, ver.y);
    }
    endShape(CLOSE);
}