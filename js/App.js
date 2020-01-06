var Engine = Matter.Engine;
var World = Matter.World;
var Body = Matter.Body;
var Bodies = Matter.Bodies;
var Bounds = Matter.Bounds;
var Vector = Matter.Vector;
var Vertices = Matter.Vertices;
var Events = Matter.Events;
var Mouse = Matter.Mouse;
var MouseConstraint = Matter.MouseConstraint;

var BLOCK_RADIUS = 24;
var BLOCK_SIDES = 6;
var TOTAL_BLOCK = 6;

var engine;
var mouse;
var mouseConstraints;
var pMousePosition;
var currDragging;
var currDraggingGroup;
var currDraggingOffset;
var targetShadow;
var blocks = [];
var groups = [];
var connections = [];

var mouseLines = [];
var mouseStartOnDrag;

function setup() {
    var canvas = createCanvas(windowWidth, windowHeight);

    // setup matter
    engine = Engine.create();
    engine.world.gravity.y = 0;
    engine.world.gravity.scale = 0;
    Engine.run(engine);

    // add hexgons
    for (var i = 0; i < TOTAL_BLOCK; i++) {
        // generate a new block and keep them centered
        var alt = i % 2 * 2 - 1; // -1 or 1
        var block = generateBlock(width / 2 + (i - TOTAL_BLOCK / 2) * BLOCK_RADIUS * 1.732, height / 2 + alt * BLOCK_RADIUS * 1.5, BLOCK_RADIUS * 2);
        blocks.push(block);
    }
    updateGroups();
    console.log(blocks[0]);

    // add walls
    World.add(engine.world, [
        Bodies.rectangle(windowWidth / 2, -20, windowWidth, 40, { isStatic: true }), //top
        Bodies.rectangle(windowWidth / 2, windowHeight + 20, windowWidth, 40, { isStatic: true }), //bottom
        Bodies.rectangle(windowWidth + 20, windowHeight / 2, 40, windowHeight, { isStatic: true }), //right
        Bodies.rectangle(-20, windowHeight / 2, 40, windowHeight, { isStatic: true }) //left
    ]);

    // add mouse interaction
    mouse = Mouse.create(canvas.elt);
    mouseConstraints = MouseConstraint.create(engine, {
        mouse: mouse
    });
    mouse.pixelRatio = pixelDensity();
    World.add(
        engine.world,
        mouseConstraints
    );
    // initialize previous mouse structure
    pMousePosition = {
        x: mouse.position.x,
        y: mouse.position.y
    };
    currDraggingOffset = {
        x: 0, y: 0
    }

    // Events.on(mouseConstraints, 'startdrag', function () {
    // });
    // Events.on(mouseConstraints, 'enddrag', function () {
    // });

    Events.on(mouseConstraints, 'mousedown', function () {
        onMouseDownEvent();
    });

    Events.on(mouseConstraints, 'mousemove', function () {
        onMouseMoveEvent();
    });

    Events.on(mouseConstraints, 'mouseup', function () {
        onMouseUpEvent();
    });
}

function draw() {
    background(0);
    drawTargetShadow();
    drawBlocks();
    drawGroupAreas();
    drawConnections();
    drawMouseLine();
}

/* RENDER */
function drawBlocks() {
    for (var i = 0; i < blocks.length; i++) {
        var one = blocks[i];
        // update round radius
        var vertices = Vertices.chamfer(one.vertices, 10, -1, 2, 14); //default chamfer
        // draw block
        noStroke();
        if (one.isHighlighted) {
            fill(240, 196, 196);
        }
        else {
            fill(240);
        }
        beginShape();
        for (var j = 0; j < vertices.length; j++) {
            var ver = vertices[j];
            vertex(ver.x, ver.y);
        }
        endShape(CLOSE);

        // draw angle indicator
        var midPoint = {
            x: one.vertices[0].x / 2 + one.vertices[one.vertices.length - 1].x / 2,
            y: one.vertices[0].y / 2 + one.vertices[one.vertices.length - 1].y / 2
        }
        stroke(255, 0, 0, 64);
        strokeWeight(1);
        line(one.position.x,
            one.position.y,
            one.position.x + (midPoint.x - one.position.x) * 0.88,
            one.position.y + (midPoint.y - one.position.y) * 0.88
        );
    }
}

function drawTargetShadow() {
    if (!targetShadow) return;
    // update round radius
    var vertices = Vertices.chamfer(targetShadow.vertices, 10, -1, 2, 14); //default chamfer
    noStroke();
    fill(255, 64);
    beginShape();
    for (var i = 0; i < vertices.length; i++) {
        var ver = vertices[i];
        vertex(ver.x, ver.y);
    }
    endShape(CLOSE);
}

function drawGroupAreas() {
    for (var i = 0; i < groups.length; i++) {
        stroke(0, 0, 255, 64);
        fill(255, 255, 0, 64);
        beginShape();
        for (var j = 0; j < groups[i].innerarea.length; j++) {
            var ver = groups[i].innerarea[j];
            vertex(ver.x, ver.y);
        }
        endShape(CLOSE);
        for (var j = 0; j < groups[i].innerarea.length; j++) {
            var ver = groups[i].innerarea[j];
            fill(255, 0, 0);
            noStroke();
            ellipse(ver.x, ver.y, 4, 4);
            vertex(ver.x, ver.y);
        }
    }
}

function drawConnections() {
    stroke(0, 255, 0, 64);
    strokeWeight(4);
    for (var i = 0; i < groups.length; i++) {
        var connections = groups[i].connections;
        for (var j = 0; j < connections.length; j++) {
            var b1 = getBlockFromID(connections[j][0]);
            var b2 = getBlockFromID(connections[j][1]);
            line(b1.position.x,
                b1.position.y,
                b2.position.x,
                b2.position.y
            );
        }
    }
}

function drawMouseLine() {
    stroke(255);
    strokeWeight(10);
    noFill();
    beginShape();
    for (var i = 0; i < mouseLines.length; i++) {
        var ver = mouseLines[i];
        vertex(ver[0], ver[1]);
    }
    endShape();
}

function updateGroupAfterMouseDrag() {
    if (mouseLines.length < 2) {
        return;
    }
    for (var i = 0; i < groups.length; i++) {
        var currGroup = groups[i];
        var filteredConn = currGroup.connections.filter(function (con) {
            var b1 = getBlockFromID(con[0]);
            var b2 = getBlockFromID(con[1]);
            var INTERSECTED = false;
            for (var j = 1; j < mouseLines.length; j++) {
                var lineIntersect = decomp.lineSegmentsIntersect([b1.position.x, b1.position.y], [b2.position.x, b2.position.y], mouseLines[j - 1], mouseLines[j]);
                if (lineIntersect) {
                    console.log('break the connection', b1.id, b2.id);
                    INTERSECTED = true;
                    break;
                }
            }
            return !INTERSECTED;
        });
        if (filteredConn.length < currGroup.connections.length) {
            // divide group
            // console.log('con:', currGroup.connections);
            var sets = [];
            for (var j = 0; j < filteredConn.length; j++) {
                var conn = filteredConn[j];
                var FOUND_IN_SETS = false;
                for (var s = 0; s < sets.length; s++) {
                    if (sets[s].includes(conn[0]) && !sets[s].includes(conn[1])) {
                        sets[s].push(conn[1]);
                        FOUND_IN_SETS = true;
                    }
                    else if (!sets[s].includes(conn[0]) && sets[s].includes(conn[1])) {
                        sets[s].push(conn[0]);
                        FOUND_IN_SETS = true;
                    }
                    else if (sets[s].includes(conn[0]) && sets[s].includes(conn[1])) {
                        FOUND_IN_SETS = true;
                    }
                }
                if (!FOUND_IN_SETS) {
                    sets.push([conn[0], conn[1]]);
                }
            }
            // console.log('sets', sets); 
            if (sets.length === 1) {
                if (currGroup.blocks.length !== sets[0].length) {
                    // reset group
                    currGroup.connections = [];
                    // separate missing block
                    var filteredBlockId = currGroup.blocks.filter(function (id) {
                        // reset block
                        var b = getBlockFromID(id);
                        b.connected = [0, 0, 0, 0, 0, 0];
                        if (sets[0].includes(id)) {
                            return false;
                        }
                        return true;
                    })[0];
                    var filteredBlock = getBlockFromID(filteredBlockId);
                    filteredBlock.group = undefined;
                    currGroup.blocks = sets[0];
                }
                else {
                    // no change
                    break;
                }
            }
            else if (sets.length === 2) {
                // reset curr grout to set 0
                console.log('there', sets);
                currGroup.blocks = sets[0];
                currGroup.connections = [];
                sets[0].map(function (id) {
                    var b = getBlockFromID(id);
                    b.connected = [0, 0, 0, 0, 0, 0];
                });
                // create a new group for the new set
                var gId = groups.length;
                sets[1].map(function (id) {
                    var b = getBlockFromID(id);
                    b.group = gId;
                    b.connected = [0, 0, 0, 0, 0, 0];
                });
                groups.push({
                    blocks: sets[1],
                    connections: []
                });
            }
            else {
                console.warn('Invalid sets');
            }

            filteredConn.map(function (c) {
                // console.log('con', c);
                createConnection(getBlockFromID(c[0]), getBlockFromID(c[1]));
            });
            break; // only break on group at a time
        }
    }
    console.log('Updated Groups:', groups);
    calculateGroupArea();
    
    // separate groups 
}

/* EVENTS */
function onMouseDownEvent() {
    console.log('mouse down');
    // start of drawing lines
    mouseStartOnDrag = true;
    mouseLines.push([mouse.position.x, mouse.position.y]);

    // record previous mouse position
    pMousePosition = {
        x: mouse.position.x,
        y: mouse.position.y
    };
    var groupsToHighlight = getGroupsToHighlight();
    if (groupsToHighlight !== undefined) {
        currDraggingGroup = groupsToHighlight;
        console.log('start group dragging', currDraggingGroup);
    }
    else if (mouseConstraints.body) {
        // set single block for free to drag around
        Body.setStatic(mouseConstraints.body, false);
        currDragging = mouseConstraints.body;
        console.log('start block dragging', currDragging);
    }
}

function onMouseMoveEvent() {
    console.log('mouse move');
    if (mouseStartOnDrag) {
        mouseLines.push([mouse.position.x, mouse.position.y]);
    }

    var mouseDiff = {
        x: mouse.position.x - pMousePosition.x,
        y: mouse.position.y - pMousePosition.y
    }
    if (currDragging === undefined && currDraggingGroup === undefined) {
        // check groups to highlight on hover
        var groupsToHighlight = getGroupsToHighlight();
        if (groupsToHighlight === undefined) {
            // reset all blocks to default
            for (var i = 0; i < blocks.length; i++) {
                var one = blocks[i];
                one.isHighlighted = false;
                // highlight individual blocks if on hover
                if (Bounds.contains(one.bounds, mouse.position)) {
                    if (Vertices.contains(one.vertices, mouse.position)) {
                        one.isHighlighted = true;
                        // console.log('on hover: ', one.id);
                    }
                }
            }
        }
        else {
            // highlight blocks inside that group
            for (var i = 0; i < blocks.length; i++) {
                var one = blocks[i];
                one.isHighlighted = (one.group === groupsToHighlight);
            }
        }
    }
    // if group is on dragging
    else if (currDraggingGroup !== undefined) {
        offsetGroupPosition(currDraggingGroup, mouseDiff);
    }
    // if indiviual block is on dragging
    else {
        // update block angle on dragging
        // angle = atan2(cross(a,b), dot(a,b))
        currDraggingOffset.x = mouse.position.x - currDragging.position.x;
        currDraggingOffset.y = mouse.position.y - currDragging.position.y;
        var addedVec = Vector.add(currDraggingOffset, Vector.mult(mouseDiff, Vector.magnitude(currDraggingOffset) / BLOCK_RADIUS));
        var rotationAngle = Math.atan2(Vector.cross(currDraggingOffset, addedVec), Vector.dot(currDraggingOffset, addedVec));
        Body.setAngle(currDragging, currDragging.angle + rotationAngle);
        console.log(currDraggingOffset, mouseDiff, currDragging.angle, rotationAngle);
        checkLocations();
    }
    // update previous mouse position
    pMousePosition.x = mouse.position.x;
    pMousePosition.y = mouse.position.y;
}

function onMouseUpEvent() {
    console.log('mouse up');
    if (mouseStartOnDrag) {
        mouseLines.push([mouse.position.x, mouse.position.y]);
        mouseStartOnDrag = false;
        updateGroupAfterMouseDrag();
        mouseLines = [];
    }

    // end individual block dragging
    if (currDragging) {
        console.log('end individual drag', currDragging);
        if (targetShadow) {
            Body.setPosition(currDragging, {
                x: targetShadow.body.position.x + targetShadow.offset.x,
                y: targetShadow.body.position.y + targetShadow.offset.y
            })
            // limit to 0 to 60
            var angleDiff = degrees(targetShadow.body.angle - currDragging.angle + PI * 2) % 60
            // update to -30 to 30 for minimal rotation
            angleDiff = angleDiff > 30 ? angleDiff - 60 : angleDiff;
            var angle = (currDragging.angle + radians(angleDiff))
            Body.setAngle(currDragging, angle);
            clearTargetShadow();
        }
        updateGroups();
        // set block to static if it belongs to a new group
        if (currDragging.group !== undefined) {
            Body.setStatic(currDragging, true);
        }
        currDragging = undefined;
    }
    // end group dragging
    if (currDraggingGroup !== undefined) {
        console.log('end group dragging', currDraggingGroup);
        currDraggingGroup = undefined;
        updateGroups();
    }
}

/* TARGET SHADOW */
function checkLocations() {
    // get the closest block
    var minDist = windowWidth;
    var targetOne;
    for (var i = 0; i < blocks.length; i++) {
        var one = blocks[i];
        if (one.id !== currDragging.id) {
            var d = dist(currDragging.position.x, currDragging.position.y, one.position.x, one.position.y);
            if (d < minDist) {
                minDist = d;
                targetOne = one;
            }
        }
    }
    if (minDist < BLOCK_RADIUS * 4.5) {
        var p1 = [targetOne.position.x, targetOne.position.y];
        var p2 = [currDragging.position.x, currDragging.position.y];
        var pInter;
        for (var j = 0; j < targetOne.vertices.length; j++) {
            var vert1 = targetOne.vertices[j];
            var vert2 = targetOne.vertices[(j + 1) % targetOne.vertices.length];
            var q1 = [vert1.x, vert1.y];
            var q2 = [vert2.x, vert2.y];
            var lineIntersect = decomp.lineSegmentsIntersect(p1, p2, q1, q2);
            if (lineIntersect) {
                pInter = {
                    x: (vert1.x + vert2.x) / 2,
                    y: (vert1.y + vert2.y) / 2
                }
                break;
            }
        }
        updateTargetShadow(targetOne, pInter);
    }
    else {
        clearTargetShadow();
    }
}

function clearTargetShadow() {
    targetShadow = null;
}

function updateTargetShadow(body, p) {
    var offsetX = (p.x - body.position.x) * 2;
    var offsetY = (p.y - body.position.y) * 2;
    // console.log('draw target location', body, p, offsetX, offsetY);
    targetShadow = {
        body: body,
        offset: {
            x: offsetX,
            y: offsetY
        },
        vertices: []
    }
    for (var i = 0; i < body.vertices.length; i++) {
        var ver = body.vertices[i];
        targetShadow.vertices.push({
            x: ver.x + offsetX,
            y: ver.y + offsetY
        })
    }
}


/* GROUPS */
function updateGroups() {
    //reset groups & connections
    groups = [];
    // connections = [];
    for (var r = 0; r < blocks.length; r++) {
        blocks[r].group = undefined;
        blocks[r].connected = [0, 0, 0, 0, 0, 0];
    }
    // loop
    for (var i = 0; i < blocks.length; i++) {
        for (var j = 1; j < blocks.length; j++) {
            if (i === j) {
                continue;
            }
            var b1 = blocks[i];
            var b2 = blocks[j];
            var d = dist(b1.position.x, b1.position.y, b2.position.x, b2.position.y);
            if (d < BLOCK_RADIUS * 3.47) {
                if (b1.group === undefined && b2.group === undefined) {
                    b1.group = b2.group = groups.length;
                    groups.push({
                        blocks: [b1.id, b2.id],
                        connections: [[b1.id, b2.id]]
                    });
                }
                else if (b1.group === undefined) {
                    b1.group = b2.group;
                    addToGroups(b1.id, b2.id);
                }
                else if (b2.group === undefined) {
                    b2.group = b1.group;
                    addToGroups(b2.id, b1.id);
                }
                else if (b1.group !== b2.group) {
                    // merge groups
                    if (b1.group < b2.group) {
                        mergeGroups(b2.group, b1.group);
                    }
                    else {
                        mergeGroups(b1.group, b2.group);
                    }
                }
                createConnection(b1, b2);
            }
        }
    }
    console.log('Groups:', groups);
    calculateGroupArea();
}

function addToGroups(from, to) {
    // console.log('add: ', from, to);
    for (var i = 0; i < groups.length; i++) {
        if (groups[i].blocks.includes(to)) {
            groups[i].blocks.push(from);
            break;
        }
    }
}

function mergeGroups(from, to) {
    // console.log('merge groups: ', groups, from, to);
    for (var i = 0; i < groups[from].blocks.length; i++) {
        var id = groups[from].blocks[i];
        var one = getBlockFromID(id);
        if (!one) {
            console.warn('unable to locate block based on ID');
        }
        one.group = to;
        groups[to].blocks.push(id);
    }
    groups[to].connections = groups[to].connections.concat(groups[from].connections);
    groups.splice(from, 1);
}

function calculateGroupArea() {
    // find the bottom right vector as starting point
    // then run CW to get all the points
    for (var i = 0; i < groups.length; i++) {
        var bks = groups[i].blocks;
        // clear area
        groups[i].area = [];

        // find bottom right block
        var brBlk = getBlockFromID(bks[0]);
        for (var j = 1; j < bks.length; j++) {
            var one = getBlockFromID(bks[j]);
            if (one.bounds.max.x + one.bounds.max.y > brBlk.bounds.max.x + brBlk.bounds.max.y) {
                brBlk = one;
            }
        }
        // find bottom right vertice
        var brPt = brBlk.vertices[0];
        for (var p = 1; p < brBlk.vertices.length; p++) {
            var pt = brBlk.vertices[p];
            if (pt.x + pt.y > brPt.x + brPt.y) {
                brPt = pt;
            }
        }

        // add bottom right vertices to group area polygon as the starting point
        groups[i].area.push(brPt);
        // find all vertices from the outer lines
        var currBlk = brBlk;
        var currPt = brBlk.vertices[(brPt.index + 1) % BLOCK_SIDES];
        // used to not crash the app
        var counter = 0;
        while (currPt !== brPt || counter > groups[i].blocks.length * BLOCK_SIDES) {
            // check whether currPt is a connection point
            var connBlkID = currBlk.connected[currPt.index];
            groups[i].area.push(currPt);
            // console.log('here', currBlk.id, currPt.index, connBlkID);
            if (connBlkID !== 0) {
                // it's connected, move to next block
                var preBlkID = currBlk.id;
                currBlk = getBlockFromID(connBlkID);
                for (var c = 0; c < BLOCK_SIDES; c++) {
                    if (currBlk.connected[c] === preBlkID) {
                        currPt = currBlk.vertices[(c + 2) % BLOCK_SIDES];
                        break;
                    }
                }
            }
            else {
                // not connected, move to next vertice
                currPt = currBlk.vertices[(currPt.index + 1) % BLOCK_SIDES];
            }
            counter++;
        }
        if (counter > groups[i].blocks.length * BLOCK_SIDES) {
            console.warn('Could not find group area');
            groups[i].area = [];
        }
        groups[i].innerarea = hmpoly.createPaddingPolygon(groups[i].area, BLOCK_RADIUS);
        // console.log(groups[i].area);
    }
}

function getGroupsToHighlight() {
    for (var i = 0; i < groups.length; i++) {
        if (pointInsidePolygon(groups[i].innerarea, mouse.position)) {
            return i;
        }
    }
    return undefined;
}

function offsetGroupPosition(id, offset) {
    console.log(id, offset);
    var bks = groups[id].blocks;
    for (var i = 0; i < bks.length; i++) {
        var one = getBlockFromID(bks[i]);
        Body.setPosition(one, {
            x: one.position.x + offset.x,
            y: one.position.y + offset.y
        });
    }
}

/* CONNECTIONS */
function addConnectionToGroup(b1, b2) {
    var gId = b1.group;
    // sort from small to big
    var id1 = b1.id < b2.id ? b1.id : b2.id;
    var id2 = b1.id < b2.id ? b2.id : b1.id;
    // check whether it's existed
    var filtered = groups[gId].connections.filter(function (p) {
        return (p[0] === id1 && p[1] === id2);
    });
    if (filtered.length === 0) {
        groups[gId].connections.push([id1, id2]);
    }
    // console.log('connection', groups[g].connections);
}

function createConnection(b1, b2) {
    // console.log('create connection with', b1.id, b2.id);
    addConnectionToGroup(b1, b2);
    var p1 = [b1.position.x, b1.position.y];
    var p2 = [b2.position.x, b2.position.y];
    for (var i = 0; i < b1.vertices.length; i++) {
        var vert1 = b1.vertices[i];
        var vert2 = b1.vertices[(i + 1) % b1.vertices.length];
        var q1 = [vert1.x, vert1.y];
        var q2 = [vert2.x, vert2.y];
        var lineIntersect = decomp.lineSegmentsIntersect(p1, p2, q1, q2);
        if (lineIntersect) {
            b1.connected[i] = b2.id;
            break;
        }
    }
    for (var j = 0; j < b2.vertices.length; j++) {
        var vert1 = b2.vertices[j];
        var vert2 = b2.vertices[(j + 1) % b2.vertices.length];
        var q1 = [vert1.x, vert1.y];
        var q2 = [vert2.x, vert2.y];
        var lineIntersect = decomp.lineSegmentsIntersect(p1, p2, q1, q2);
        if (lineIntersect) {
            b2.connected[j] = b1.id;
            break;
        }
    }
}

/* BLOCKS */

function getBlockFromID(id) {
    for (var i = 0; i < blocks.length; i++) {
        if (blocks[i].id === id) {
            return blocks[i];
        }
    }
    return null;
}

function generateBlock(x, y, s) {
    var block = Bodies.polygon(x, y, BLOCK_SIDES, s, {
        friction: 0.8,
        frictionAir: 0.8,
        isStatic: true
    });
    World.addBody(engine.world, block);
    return block;
}

/* UTILITIES */

function pointInsidePolygon(vs, pt) {
    var inside = false;
    for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        var xi = vs[i].x, yi = vs[i].y;
        var xj = vs[j].x, yj = vs[j].y;

        var intersect = ((yi > pt.y) != (yj > pt.y))
            && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}
