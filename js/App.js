var Engine = Matter.Engine;
var World = Matter.World;
var Composite = Matter.Composite;
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

// var targetShadow;
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
    initializeGroups();

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
    smooth();
    background(0);
    // drawTargetShadow();
    drawBlocks();
    drawGroupAreas();
    drawConnections();
    drawMouseLine();

    drawWorld();
}

/* RENDER */
function drawWorld() {
    Composite.allBodies(engine.world).map(function (b) {
        // draw block https://github.com/liabru/matter-js/blob/master/src/render/Render.js
        noStroke();
        fill(240, 196, 196, 128);
        beginShape();
        for (k = b.parts.length > 1 ? 1 : 0; k < b.parts.length; k++) {
            var part = b.parts[k];
            vertex(part.vertices[0].x, part.vertices[0].y);

            for (j = 1; j < part.vertices.length; j++) {
                if (!part.vertices[j - 1].isInternal) {
                    vertex(part.vertices[j].x, part.vertices[j].y);
                } else {
                    vertex(part.vertices[j].x, part.vertices[j].y);
                }

                if (part.vertices[j].isInternal) {
                    vertex(part.vertices[(j + 1) % part.vertices.length].x, part.vertices[(j + 1) % part.vertices.length].y);
                }
            }
            vertex(part.vertices[0].x, part.vertices[0].y);
        }
        endShape(CLOSE);
    });
}

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

    // var vertices = Vertices.chamfer(targetShadow.vertices, 10, -1, 2, 14); //default chamfer
    // noStroke();
    // fill(255, 64);
    // beginShape();
    // for (var i = 0; i < vertices.length; i++) {
    //     var ver = vertices[i];
    //     vertex(ver.x, ver.y);
    // }
    // endShape(CLOSE);
}

function drawGroupAreas() {
    for (var i = 0; i < groups.length; i++) {
        if (!groups[i].innerpts) {
            return;
        }
        stroke(0, 0, 255, 64);
        fill(255, 255, 0, 64);
        beginShape();
        for (var j = 0; j < groups[i].innerpts.length; j++) {
            var ver = groups[i].innerpts[j];
            vertex(ver.x, ver.y);
        }
        endShape(CLOSE);
        for (var j = 0; j < groups[i].innerpts.length; j++) {
            var ver = groups[i].innerpts[j];
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
            var b0 = getBlockFromID(connections[j][0]);
            var b1 = getBlockFromID(connections[j][1]);
            line(b0.position.x,
                b0.position.y,
                b1.position.x,
                b1.position.y
            );
        }
    }
}

function drawMouseLine() {
    if (mouseLines.length < 2) {
        return;
    }

    // draw stroke
    stroke(255, 64, 64);
    fill(255, 64, 64);
    strokeWeight(4);
    strokeCap(ROUND);
    strokeJoin(ROUND);
    var drawingPath = [];
    var prevPoint = mouseLines[0];
    drawingPath.push(prevPoint);
    for (var n = 1; n < mouseLines.length; n++) {
        var currPoint = mouseLines[n];
        var delta = p5.Vector.sub(currPoint, prevPoint);
        var midPoint = p5.Vector.add(currPoint, prevPoint).div(2);
        var step = delta.div(10);
        step.rotate(0.75);
        var top = p5.Vector.add(midPoint, step);
        var bottom = p5.Vector.sub(midPoint, step);
        drawingPath.push(top);
        drawingPath.unshift(bottom);
        prevPoint = currPoint;
    }
    beginShape();
    for (var p = 0; p < drawingPath.length; p++) {
        curveVertex(drawingPath[p].x, drawingPath[p].y);
    }
    endShape(CLOSE);
}

function updateAfterMouseDrag() {
    if (mouseLines.length < 2) {
        return;
    }
    // get first group that got connections broken
    var gid = -1;
    var brokenConns = [];
    for (var i = 1; i < mouseLines.length; i++) {
        if (gid < 0) {
            for (var j = 0; j < groups.length; j++) {
                var INTERSECTED = false;
                for (var m = 0; m < groups[j].connections.length; m++) {
                    var b0 = getBlockFromID(groups[j].connections[m][0]);
                    var b1 = getBlockFromID(groups[j].connections[m][1]);
                    var lineIntersect = lineSegmentsIntersect(b0.position, b1.position, mouseLines[i - 1], mouseLines[i]);
                    if (lineIntersect) {
                        INTERSECTED = true;
                        gid = j;
                        brokenConns.push([b0.id, b1.id]);
                        console.log('break the connection', b0.id, b1.id);
                        break;
                    }
                }
                if (INTERSECTED) {
                    break;
                }
            }
        }
        else {
            for (var m = 0; m < groups[gid].connections.length; m++) {
                var b0 = getBlockFromID(groups[gid].connections[m][0]);
                var b1 = getBlockFromID(groups[gid].connections[m][1]);
                var lineIntersect = lineSegmentsIntersect(b0.position, b1.position, mouseLines[i - 1], mouseLines[i]);
                if (lineIntersect) {
                    var filteredBC = brokenConns.filter(function (p) {
                        return p[0] === b0.id && p[1] === b1.id;
                    });
                    if (filteredBC.length === 0) {
                        brokenConns.push([b0.id, b1.id]);
                        console.log('break the connection', b0.id, b1.id);
                    }
                    break;
                }
            }
        }
    }

    if (gid >= 0 && brokenConns.length > 0) {
        divideGroup(gid, brokenConns);
        // separate groups 
    }
}

/* EVENTS */
function onMouseDownEvent() {
    console.log('mouse down');
    mouseStartOnDrag = true;
    mouseLines.push(createVector(mouse.position.x, mouse.position.y));
}

function onMouseMoveEvent() {
    console.log('mouse move');
    if (mouseStartOnDrag) {
        mouseLines.push(createVector(mouse.position.x, mouse.position.y));
        return;
    }
}

function onMouseUpEvent() {
    console.log('mouse up');
    if (mouseStartOnDrag) {
        mouseLines.push(createVector(mouse.position.x, mouse.position.y));
        mouseStartOnDrag = false;
        updateAfterMouseDrag();
        mouseLines = [];
    }
}

/* TARGET SHADOW */
function checkLocations() {
    // get the closest block
    // var minDist = windowWidth;
    // var targetOne;
    // for (var i = 0; i < blocks.length; i++) {
    //     var one = blocks[i];
    //     if (one.id !== currDragging.id) {
    //         var d = dist(currDragging.position.x, currDragging.position.y, one.position.x, one.position.y);
    //         if (d < minDist) {
    //             minDist = d;
    //             targetOne = one;
    //         }
    //     }
    // }
    // if (minDist < BLOCK_RADIUS * 4.5) {
    //     var p1 = [targetOne.position.x, targetOne.position.y];
    //     var p2 = [currDragging.position.x, currDragging.position.y];
    //     var pInter;
    //     for (var j = 0; j < targetOne.vertices.length; j++) {
    //         var vert1 = targetOne.vertices[j];
    //         var vert2 = targetOne.vertices[(j + 1) % targetOne.vertices.length];
    //         var q1 = [vert1.x, vert1.y];
    //         var q2 = [vert2.x, vert2.y];
    //         var lineIntersect = decomp.lineSegmentsIntersect(p1, p2, q1, q2);
    //         if (lineIntersect) {
    //             pInter = {
    //                 x: (vert1.x + vert2.x) / 2,
    //                 y: (vert1.y + vert2.y) / 2
    //             }
    //             break;
    //         }
    //     }
    //     updateTargetShadow(targetOne, pInter);
    // }
    // else {
    //     clearTargetShadow();
    // }
}

// function clearTargetShadow() {
//     targetShadow = null;
// }

// function updateTargetShadow(body, p) {
//     var offsetX = (p.x - body.position.x) * 2;
//     var offsetY = (p.y - body.position.y) * 2;
//     // console.log('draw target location', body, p, offsetX, offsetY);
//     targetShadow = {
//         body: body,
//         offset: {
//             x: offsetX,
//             y: offsetY
//         },
//         vertices: []
//     }
//     for (var i = 0; i < body.vertices.length; i++) {
//         var ver = body.vertices[i];
//         targetShadow.vertices.push({
//             x: ver.x + offsetX,
//             y: ver.y + offsetY
//         })
//     }
// }


/* GROUPS */

function getGroupIndex(bid) {
    for (var i = 0; i < groups.length; i++) {
        if (groups[i].blocks.includes(bid)) {
            return i;
        }
    }
    return -1;
}

function initializeGroups() {
    groups = [];
    var bks = [];
    var conns = [];
    // create connection array for each block
    for (var r = 0; r < blocks.length; r++) {
        bks.push(blocks[r].id);
        blocks[r].connected = [0, 0, 0, 0, 0, 0];
    }
    // loop combination of two
    for (var i = 0; i < blocks.length - 1; i++) {
        for (var j = i + 1; j < blocks.length; j++) {
            var b0 = blocks[i];
            var b1 = blocks[j];
            // check block distance
            var d = dist(b0.position.x, b0.position.y, b1.position.x, b1.position.y);
            if (d < BLOCK_RADIUS * 3.47) {
                conns.push([b0.id, b1.id]);
            }
        }
    }
    createGroup(bks, conns);
}

function createGroup(bks, conns) {
    var createdArr = [];
    var gid;
    conns.map(function (conn) {
        var b0 = getBlockFromID(conn[0]);
        var b1 = getBlockFromID(conn[1]);
        var bi0 = getGroupIndex(b0.id);
        var bi1 = getGroupIndex(b1.id);
        if (bi0 === -1 && bi1 === -1) { // neither is defined
            gid = groups.length;
            createdArr.push(gid);
            groups.push({
                blocks: [b0.id, b1.id],
                connections: []
            });
            bks = bks.filter(function (bid) {
                return bid !== b0.id && bid !== b1.id;
            });
        }
        else if (bi0 === -1 || bi1 === -1) { // one is undefined
            if (bi0 < 0) {
                gid = bi1;
                groups[gid].blocks.push(b0.id);
                bks = bks.filter(function (bid) {
                    return bid !== b0.id;
                });
            }
            else {
                gid = bi0;
                groups[gid].blocks.push(b1.id);
                bks = bks.filter(function (bid) {
                    return bid !== b1.id;
                });
            }
        }
        else if (bi0 !== bi1) { // merge group
            var gidFrom;
            if (bi0 < bi1) {
                gidFrom = bi1;
                gid = bi0;
            }
            else {
                gid = bi1;
                gidFrom = bi0;
            }
            groups[gid].blocks = groups[gid].blocks.concat(groups[gidFrom].blocks);
            groups[gid].connections = groups[gid].connections.concat(groups[gidFrom].connections);
            groups.splice(gidFrom, 1);
        }
        // add connections
        groups[gid].connections.push([b0.id, b1.id]);
        createConnection(b0, b1);
    });

    console.log('single blocks', bks);


    // generate group points for groups
    createdArr.map(function (g) {
        generateGroupPts(g);
        console.log('create a new body', groups[g].pts);
        // add group to the world
        generatePolygonFromVertices(groups[g].pts);
    });

    // create group points for singles
    bks.map(function (bid) {
        var bk = getBlockFromID(bid);
        groups.push({
            blocks: [bid],
            connections: [],
            pts: bk.vertices,
            innerpts: hmpoly.createPaddingPolygon(bk.vertices, BLOCK_RADIUS)
        })
        // add group to the world
        generatePolygonFromVertices(bk.vertices);
    });
    console.log('Groups:', groups);
    console.log('World', Composite.allBodies(engine.world));
}

function analyzingConnections(conns) {
    var sets = [];
    for (var i = 0; i < conns.length; i++) {
        var conn = conns[i];
        var cs0 = -1;
        var cs1 = -1;
        sets.map(function (s, i) {
            if (s.includes(conn[0]) && cs0 < 0) {
                cs0 = i;
            }
            if (s.includes(conn[1]) && cs1 < 0) {
                cs1 = i
            }
        });
        if (cs0 < 0 && cs1 < 0) {
            sets.push([conn[0], conn[1]]);
        }
        if (cs0 < 0 && cs1 >= 0 && !sets[cs1].includes(conn[0])) {
            sets[cs1].push(conn[0]);
        }
        if (cs1 < 0 && cs0 >= 0 && !sets[cs0].includes(conn[1])) {
            sets[cs0].push(conn[1]);
        }
        if (cs0 >= 0 && cs1 >= 0 && cs0 !== cs1) {
            sets[cs0] = sets[cs0].concat(sets[cs1]);
            sets.splice(cs1, 1);
        }
    }
    return sets;
}

function divideGroup(gid, bconns) {
    console.log('divide group ', gid, bconns);

    var filteredConns = groups[gid].connections.filter(function (c) {
        var FOUND = false;
        bconns.map(function (bc) {
            if (bc[0] === c[0] && bc[1] === c[1]) {
                FOUND = true;
            }
        });
        return !FOUND;
    });

    // valid break connections
    var sets = analyzingConnections(filteredConns);
    console.log('sets', sets);

    bconns.map(function (bc) {
        var FOUND = false;
        sets.map(function (s) {
            if (s.includes(bc[0]) && s.includes(bc[1])) {
                FOUND = true;
            }
        });
        if (FOUND) {
            // push back invalid break connection
            filteredConns.push(bc);
        }
    });
    if (filteredConns.length === groups[gid].connections.length) {
        return;
    }
    console.log('filtered connections', filteredConns);

    // clear block connections 
    var bks = groups[gid].blocks;
    for (var j = 0; j < bks.length; j++) {
        var b = getBlockFromID(groups[gid].blocks[j]);
        b.connected = [0, 0, 0, 0, 0, 0];
    }
    groups.splice(gid, 1);
    createGroup(bks, filteredConns);
}

function generateGroupPts(gid) {
    var group = groups[gid];

    // find the bottom right vector as starting point
    // then run CW to get all the points
    var bks = group.blocks;
    // clear pts
    group.pts = [];

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

    // add bottom right vertice to group pts as the starting point
    group.pts.push({
        x: brPt.x,
        y: brPt.y
    });
    // find all vertices from the outer lines
    var currBlk = brBlk;
    var currPt = brBlk.vertices[(brPt.index + 1) % BLOCK_SIDES];
    // used to not crash the app
    var counter = 0;
    while (currPt !== brPt || counter > group.blocks.length * BLOCK_SIDES) {
        // check whether currPt is a connection point
        var connBlkID = currBlk.connected[currPt.index];
        group.pts.push({
            x: currPt.x,
            y: currPt.y
        });
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
    if (counter > group.blocks.length * BLOCK_SIDES) {
        console.warn('Could not find group pts');
        group.pts = [];
    }
    // console.log(group);
    group.innerpts = hmpoly.createPaddingPolygon(group.pts, BLOCK_RADIUS);
}

function getGroupsToHighlight() {
    for (var i = 0; i < groups.length; i++) {
        if (pointInsidePolygon(groups[i].innerarea, mouse.position)) {
            return i;
        }
    }
    return undefined;
}


/* CONNECTIONS */

function createConnection(b0, b1) {
    // console.log('create connection with', b0.id, b1.id);
    for (var i = 0; i < b0.vertices.length; i++) {
        var v0 = b0.vertices[i];
        var v1 = b0.vertices[(i + 1) % b0.vertices.length];
        var lineIntersect = lineSegmentsIntersect(b0.position, b1.position, v0, v1);
        if (lineIntersect) {
            b0.connected[i] = b1.id;
            break;
        }
    }
    for (var j = 0; j < b1.vertices.length; j++) {
        var v0 = b1.vertices[j];
        var v1 = b1.vertices[(j + 1) % b1.vertices.length];
        var lineIntersect = lineSegmentsIntersect(b0.position, b1.position, v0, v1);
        if (lineIntersect) {
            b1.connected[j] = b0.id;
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
    var block = Bodies.polygon(x, y, BLOCK_SIDES, s,
    {
        isStatic: true
    });
    return block;
}

function generatePolygonFromVertices(vts) {
    var cx = 0;
    var cy = 0;
    vts.map(function(vt){
        cx += vt.x;
        cy += vt.y
    });
    cx /= vts.length;
    cy /= vts.length;
    var gBody = Bodies.fromVertices(cx, cy, vts, {
        friction: 0.8,
        frictionAir: 0.8,
    }, true);
    World.add(engine.world, gBody);
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

// Checks if two line segments intersects
function lineSegmentsIntersect(p1, p2, q1, q2) {
    var dx = p2.x - p1.x;
    var dy = p2.y - p1.y;
    var da = q2.x - q1.x;
    var db = q2.y - q1.y;

    // segments are parallel
    if ((da * dy - db * dx) === 0) {
        return false;
    }

    var s = (dx * (q1.y - p1.y) + dy * (p1.x - q1.x)) / (da * dy - db * dx);
    var t = (da * (p1.y - q1.y) + db * (q1.x - p1.x)) / (db * dx - da * dy);

    return (s >= 0 && s <= 1 && t >= 0 && t <= 1);
}