var Engine = Matter.Engine
var World = Matter.World
var Common = Matter.Common
var Composite = Matter.Composite
var Body = Matter.Body
var Bodies = Matter.Bodies
var Bounds = Matter.Bounds
var Vector = Matter.Vector
var Vertices = Matter.Vertices
var Events = Matter.Events
var Mouse = Matter.Mouse
var MouseConstraint = Matter.MouseConstraint

var BLOCK_RADIUS = 24
var BLOCK_SIDES = 6
var TOTAL_BLOCK = 6

var engine
var mouse
var mouseConstraints
var bodies = [] // MatterJS World Bodies()

var blocks = [] // hexgon blocks
var groups = [] // data structure for block groups
var connections = []

var currDragging
var currShadow
var target = {}
var pMousePosition

var mouseLines = []
var mouseStartOnDrag

var collisionTimeout // trigger end of collision

var SETTINGS = {
    global: {
        debugMode: false,
        resetGame: function () {
            clearCanvas()
            initializeBlocks()
        },
        clearCanvas: function () {
            clearCanvas()
        }
    },
    blocks: {
        cornerRadius: 10,
        friction: 0.8,
        frictionAir: 0.8,
    }
}

function setup() {
    var canvas = createCanvas(windowWidth, windowHeight)

    // setup matter
    engine = Engine.create()
    engine.world.gravity.y = 0
    engine.world.gravity.scale = 0
    Engine.run(engine)

    // add walls
    World.add(engine.world, [
        Bodies.rectangle(windowWidth / 2, -20, windowWidth, 40, { isStatic: true }), //top
        Bodies.rectangle(windowWidth / 2, windowHeight + 20, windowWidth, 40, { isStatic: true }), //bottom
        Bodies.rectangle(windowWidth + 20, windowHeight / 2, 40, windowHeight, { isStatic: true }), //right
        Bodies.rectangle(-20, windowHeight / 2, 40, windowHeight, { isStatic: true }) //left
    ])

    // add mouse interaction
    mouse = Mouse.create(canvas.elt)
    mouseConstraints = MouseConstraint.create(engine, {
        mouse: mouse
    })
    mouse.pixelRatio = pixelDensity()
    World.add(
        engine.world,
        mouseConstraints
    )

    Events.on(mouseConstraints, 'mousedown', function () {
        onMouseDownEvent()
    })

    Events.on(mouseConstraints, 'mousemove', function () {
        onMouseMoveEvent()
    })

    Events.on(mouseConstraints, 'mouseup', function () {
        onMouseUpEvent()
    })

    // Collision Event
    Events.on(engine, "collisionEnd", function (e) {
        if(collisionTimeout){
            clearTimeout(collisionTimeout)
            collisionTimeout = null
        }
        collisionTimeout = setTimeout(function() {
            //end of collision
            groups.map(function (g, i) {
                generateGroupPts(i)
            })
        }, 200)
    })

    // add Dat GUI
    var gui = new dat.GUI()
    gui.add(SETTINGS.global, 'resetGame')
    gui.add(SETTINGS.global, 'clearCanvas')
    gui.add(SETTINGS.global, 'debugMode')
    var gui_blocks = gui.addFolder('Blocks')
    gui_blocks.open()
    gui_blocks
        .add(SETTINGS.blocks, 'cornerRadius', 0, 20)
    gui_blocks
        .add(SETTINGS.blocks, 'friction', 0, 1)
        .onFinishChange(function (value) {
            bodies.map(b => {
                b.friction = value
            })
            console.log(bodies)
        })
    gui_blocks
        .add(SETTINGS.blocks, 'frictionAir', 0, 1)
        .onFinishChange(function (value) {
            bodies.map(b => {
                b.frictionAir = value
            })
            console.log(bodies)
        })

    initializeBlocks()
}

function draw() {
    smooth()
    background(0)
    if (currDragging) {
        target.group = detectSnappingGroup()
        if (target.group) {
            var currGroup = getGroupByMatterBody(currDragging)
            if (SETTINGS.global.debugMode) {
                drawSpikes(currGroup.spikes)
                drawMatchingEdge(currGroup, target.group)
            }
            currShadow.opacity += (64 - currShadow.opacity) * 0.2
            drawTargetShadow(currGroup, target.group)
        }
        else {
            currShadow.opacity += (0 - currShadow.opacity) * 0.2
        }
    }

    drawBlocks()

    if (SETTINGS.global.debugMode) {
        drawConnections()
    }

    drawMouseLine()
}

function clearCanvas() {
    bodies.map(b => {
        World.remove(engine.world, b, true)
    })
    bodies = []
    blocks = []
    groups = []
}

function initializeBlocks() {
    // add hexgons
    for (var i = 0; i < TOTAL_BLOCK; i++) {
        // generate a new block and keep them centered
        var alt = i % 2 * 2 - 1 // -1 or 1
        var block = generateBlock(width / 2 + (i - TOTAL_BLOCK / 2) * BLOCK_RADIUS * 1.732, height / 2 + alt * BLOCK_RADIUS * 1.5, BLOCK_RADIUS * 2)
        blocks.push(block)
    }
    initializeGroups()
}

/* RENDER */

/* Target Shadow */

function detectSnappingGroup() {
    var currGroup
    var result
    if (currDragging) {
        // generate spikes for current dragging group
        groups.map(function (g) {
            if (currDragging === g.poly) {
                currGroup = g
                g.spikes = []
                for (var i = 0; i < g.pts.length; i++) {
                    var ii = (i + 1) % g.pts.length
                    var centerPt = Vector.mult(Vector.add(g.pts[i], g.pts[ii]), 0.5)
                    var farPt = Vector.add(centerPt, Vector.mult(Vector.sub(centerPt, g.pts[ii].body.position), 0.88))
                    g.spikes.push([centerPt, farPt, false, g.pts[i], g.pts[ii]])
                }
            }
        })

        // finding intersacting group
        for (var i = 0; i < groups.length; i++) {
            var g = groups[i]
            if (g === currGroup) {
                continue
            }
            var FOUND = false
            var minDistance = 1000
            currGroup.spikes.map(function (sp, spi) {
                var spii = (spi + 1) % currGroup.spikes.length
                if (pointInsidePolygon(g.pts, sp[1])) {
                    sp[2] = true
                    FOUND = true

                    // find the matching line
                    var p0 = sp[3]
                    var p1 = sp[4]
                    var m0 = Vector.div(Vector.add(p0, p1), 2)
                    for (var j = 0; j < g.pts.length; j++) {
                        var jj = (j + 1) % g.pts.length
                        var p2 = g.pts[j]
                        var p3 = g.pts[jj]
                        var m1 = Vector.div(Vector.add(p2, p3), 2)
                        var d = Vector.magnitude(Vector.sub(m0, m1))
                        if (d < minDistance) {
                            minDistance = d
                            currGroup.intersectings = [spi, spii]
                            g.intersectings = [j, jj]
                        }
                    }
                }
            })
            if (FOUND) {
                result = g
                break
            }
        }
    }
    return result
}

function drawSpikes(spikes) {
    noFill()
    spikes.map(function (sp) {
        if (sp[2]) {
            strokeWeight(1)
            stroke(255, 0, 0, 128)
            line(sp[0].x, sp[0].y, sp[1].x, sp[1].y)
        }
        else {
            strokeWeight(1)
            stroke(0, 255, 0, 64)
            line(sp[0].x, sp[0].y, sp[1].x, sp[1].y)
        }
    })
}

function drawMatchingEdge(cg, tg) {
    var p0 = cg.pts[cg.intersectings[0]]
    var p1 = cg.pts[cg.intersectings[1]]
    var p2 = tg.pts[tg.intersectings[0]]
    var p3 = tg.pts[tg.intersectings[1]]
    strokeWeight(4)
    stroke(0, 0, 255, 128)
    line(p0.x, p0.y, p1.x, p1.y)
    line(p2.x, p2.y, p3.x, p3.y)
}

function drawTargetShadow(cg, tg) {
    // use p5 vector to calculate angle to get desired result
    var p0 = createVector(cg.pts[cg.intersectings[0]].x, cg.pts[cg.intersectings[0]].y, 0)
    var p1 = createVector(cg.pts[cg.intersectings[1]].x, cg.pts[cg.intersectings[1]].y, 0)
    var p2 = createVector(tg.pts[tg.intersectings[0]].x, tg.pts[tg.intersectings[0]].y, 0)
    var p3 = createVector(tg.pts[tg.intersectings[1]].x, tg.pts[tg.intersectings[1]].y, 0)
    target.angle = p5.Vector.sub(p0, p1).angleBetween(p5.Vector.sub(p3, p2))
    Vertices.rotate([p0, p1], target.angle, cg.poly.position)
    var mp0 = p5.Vector.add(p0, p1).div(2)
    var mp1 = p5.Vector.add(p2, p3).div(2)
    target.offset = p5.Vector.sub(mp1, mp0)
    // console.log('angle & offset', target.angle, target.offset)

    // draw shadow out
    noStroke()
    fill(255, currShadow.opacity)
    cg.poly.parts.filter(function (part, i) {
        return i !== 0
    }).map(function (p) {
        var vCopy = p.vertices.map(function (v) {
            return {
                x: v.x,
                y: v.y
            }
        })
        if (target.angle !== 0) {
            Vertices.rotate(vCopy, target.angle, cg.poly.position)
        }
        Vertices.translate(vCopy, target.offset)
        var vertices = Vertices.chamfer(vCopy, SETTINGS.blocks.cornerRadius, -1, 2, 14)
        beginShape()
        vertices.map(function (ver) {
            vertex(ver.x, ver.y)
        })
        endShape(CLOSE)
    })
}

function drawBlocks() {
    for (var i = 0; i < blocks.length; i++) {
        var one = blocks[i]
        // update round radius
        var vertices = Vertices.chamfer(one.vertices, SETTINGS.blocks.cornerRadius, -1, 2, 14) //default chamfer
        // draw block
        noStroke()
        if (one.isHighlighted) {
            fill(240, 128, 128)
        }
        else {
            fill(240)
        }
        beginShape()
        for (var j = 0; j < vertices.length; j++) {
            var ver = vertices[j]
            vertex(ver.x, ver.y)
        }
        endShape(CLOSE)

        if (SETTINGS.global.debugMode) {
            // draw angle indicator
            var midPoint = {
                x: one.vertices[0].x / 2 + one.vertices[one.vertices.length - 1].x / 2,
                y: one.vertices[0].y / 2 + one.vertices[one.vertices.length - 1].y / 2
            }
            stroke(0, 0, 255, 64)
            strokeWeight(1)
            line(one.position.x,
                one.position.y,
                one.position.x + (midPoint.x - one.position.x) * 0.88,
                one.position.y + (midPoint.y - one.position.y) * 0.88
            )
        }
    }
}

function drawGroupAreas() {
    for (var i = 0; i < groups.length; i++) {
        if (!groups[i].innerpts) {
            return
        }
        stroke(0, 0, 255, 64)
        strokeWeight(1)
        fill(255, 255, 0, 64)
        beginShape()
        for (var j = 0; j < groups[i].innerpts.length; j++) {
            var ver = groups[i].innerpts[j]
            vertex(ver.x, ver.y)
        }
        endShape(CLOSE)
        for (var j = 0; j < groups[i].innerpts.length; j++) {
            var ver = groups[i].innerpts[j]
            fill(255, 0, 0)
            noStroke()
            ellipse(ver.x, ver.y, 4, 4)
            vertex(ver.x, ver.y)
        }
    }
}

function drawConnections() {
    stroke(0, 255, 0, 64)
    strokeWeight(4)
    for (var i = 0; i < groups.length; i++) {
        var connections = groups[i].connections
        for (var j = 0; j < connections.length; j++) {
            var b0 = getBlockFromID(connections[j][0])
            var b1 = getBlockFromID(connections[j][1])
            line(b0.position.x,
                b0.position.y,
                b1.position.x,
                b1.position.y
            )
        }
    }
}

function drawMouseLine() {
    if (mouseLines.length < 2) {
        return
    }

    // draw stroke
    stroke(255, 64, 64)
    fill(255, 64, 64)
    strokeWeight(4)
    strokeCap(ROUND)
    strokeJoin(ROUND)
    var drawingPath = []
    var prevPoint = mouseLines[0]
    drawingPath.push(prevPoint)
    for (var n = 1; n < mouseLines.length; n++) {
        var currPoint = mouseLines[n]
        var delta = Vector.sub(currPoint, prevPoint)
        var midPoint = Vector.div(Vector.add(currPoint, prevPoint), 2)
        var step = Vector.rotate(Vector.div(delta, 10), 0.75)
        var top = Vector.add(midPoint, step)
        var bottom = Vector.sub(midPoint, step)
        drawingPath.push(top)
        drawingPath.unshift(bottom)
        prevPoint = currPoint
    }
    beginShape()
    for (var p = 0; p < drawingPath.length; p++) {
        curveVertex(drawingPath[p].x, drawingPath[p].y)
    }
    endShape(CLOSE)
}

function updateAfterMouseDrag() {
    if (mouseLines.length < 2) {
        return
    }
    // get first group that got connections broken
    var gid = -1
    var brokenConns = []
    for (var i = 1; i < mouseLines.length; i++) {
        if (gid < 0) {
            for (var j = 0; j < groups.length; j++) {
                var INTERSECTED = false
                for (var m = 0; m < groups[j].connections.length; m++) {
                    var b0 = getBlockFromID(groups[j].connections[m][0])
                    var b1 = getBlockFromID(groups[j].connections[m][1])
                    var lineIntersect = lineSegmentsIntersect(b0.position, b1.position, mouseLines[i - 1], mouseLines[i])
                    if (lineIntersect) {
                        INTERSECTED = true
                        gid = j
                        brokenConns.push([b0.id, b1.id])
                        if (SETTINGS.global.debugMode)
                            console.log('break the connection', b0.id, b1.id)
                    }
                }
                if (INTERSECTED) {
                    break
                }
            }
        }
        else {
            for (var m = 0; m < groups[gid].connections.length; m++) {
                var b0 = getBlockFromID(groups[gid].connections[m][0])
                var b1 = getBlockFromID(groups[gid].connections[m][1])
                var lineIntersect = lineSegmentsIntersect(b0.position, b1.position, mouseLines[i - 1], mouseLines[i])
                if (lineIntersect) {
                    var filteredBC = brokenConns.filter(function (p) {
                        return p[0] === b0.id && p[1] === b1.id
                    })
                    if (filteredBC.length === 0) {
                        brokenConns.push([b0.id, b1.id])
                        if (SETTINGS.global.debugMode)
                            console.log('break the connection', b0.id, b1.id)
                    }
                }
            }
        }
    }

    if (gid >= 0 && brokenConns.length > 0) {
        divideGroup(gid, brokenConns)
    }
}

/* EVENTS */
function onMouseDownEvent() {
    // console.log('mouse down', engine.world.bodies)
    pMousePosition = Vector.clone(mouse.position)

    if (mouseConstraints.body) {
        currDragging = mouseConstraints.body
        // clone pts and part vertices
        currShadow = { opacity: 0 }
        // console.log('current shadow', currShadow)
        return
    }
    mouseStartOnDrag = true
    mouseLines.push(createVector(mouse.position.x, mouse.position.y))

    bodies.map(function (b) {
        Body.setStatic(b, true)
    })
}

function onMouseMoveEvent() {
    // console.log('mouse move')
    if (mouseStartOnDrag) {
        mouseLines.push(createVector(mouse.position.x, mouse.position.y))
        return
    }
    if (currDragging) {
        // update block angle on dragging
        // angle = atan2(cross(a,b), dot(a,b))
        var currDraggingOffset = Vector.sub(mouse.position, currDragging.position)
        var mouseDelta = Vector.sub(mouse.position, pMousePosition)
        // var addedVec = Vector.add(currDraggingOffset, Vector.mult(mouseDelta, Vector.magnitude(currDraggingOffset) / BLOCK_RADIUS / currDragging.parts.length))
        // var rotationAngle = Math.atan2(Vector.cross(currDraggingOffset, addedVec), Vector.dot(currDraggingOffset, addedVec))
        // Body.setAngle(currDragging, currDragging.angle + rotationAngle)
        Body.applyForce(currDragging, pMousePosition, Vector.mult(Vector.normalise(mouseDelta), Vector.magnitude(currDraggingOffset) / currDragging.parts.length / 256))
        pMousePosition = Vector.clone(mouse.position)

        return
    }
    bodies.map(function (b) {
        b.parts.map(p => p.isHighlighted = false)
        // highlight group polygon if on hover
        if (Bounds.contains(b.bounds, mouse.position)) {
            for (var i = 1; i < b.parts.length; i++) {
                var part = b.parts[i]
                if (pointInsidePolygon(part.vertices, mouse.position)) {
                    b.parts.map(p => p.isHighlighted = true)
                    break
                }
            }
        }
    })
}

function onMouseUpEvent() {
    // console.log('mouse up')
    if (mouseStartOnDrag) {
        mouseLines.push(createVector(mouse.position.x, mouse.position.y))
        mouseStartOnDrag = false
        updateAfterMouseDrag()
        mouseLines = []

        // set group non static
        bodies.map(function (b) {
            Body.setStatic(b, false)
        })
    }

    if (currDragging) {
        if (target.group) {
            var currGroup = getGroupByMatterBody(currDragging)
            // console.log(currGroup, target.group)
            Body.rotate(currDragging, target.angle)
            Body.translate(currDragging, target.offset)
            // update group
            var bks = currGroup.blocks.concat(target.group.blocks)
            bodies = bodies.filter(function (b) {
                if (b === target.group.poly || b === currGroup.poly) {
                    World.remove(engine.world, b)
                    return false
                }
                return true
            })
            groups.splice(getGroupIndex(currGroup), 1)
            groups.splice(getGroupIndex(target.group), 1)
            formGroupByLocation(bks)
            target.group = null
        }
        else {
            if (SETTINGS.global.debugMode)
                console.log("drag done")
            groups.map(function (g, i) {
                generateGroupPts(i)
            })
        }
        currDragging = null
        currShadow.opacity = 0
    }
}

function doubleClicked() {
    var mouseInsideGroups = false
    bodies.map(function (b) {
        if (Bounds.contains(b.bounds, mouse.position)) {
            mouseInsideGroups = true
        }
    })
    if(!mouseInsideGroups){
        var block = generateBlock(mouseX, mouseY, BLOCK_RADIUS * 2)
        blocks.push(block)
        formGroupByLocation([block.id])
    }
}

/* GROUPS */

function getGroupByBlockIndex(bid) {
    for (var i = 0; i < groups.length; i++) {
        if (groups[i].blocks.includes(bid)) {
            return i
        }
    }
    return -1
}

function getGroupIndex(group) {
    var result
    for (var i = 0; i < groups.length; i++) {
        if (groups[i] === group) {
            result = i
            break
        }
    }
    return result
}

function getGroupByMatterBody(bd) {
    var result
    result = groups.filter(function (g) {
        return g.poly === bd
    })
    if (result.length === 1) {
        return result[0]
    }
    return null
}

function initializeGroups() {
    groups = []
    var bks = []
    // create connection array for each block
    for (var r = 0; r < blocks.length; r++) {
        bks.push(blocks[r].id)
    }
    formGroupByLocation(bks)
}

function formGroupByLocation(bks) {
    var conns = []
    // clear block connected array
    for (var i = 0; i < bks.length; i++) {
        getBlockFromID(bks[i]).connected = [0, 0, 0, 0, 0, 0]
    }

    // loop combination of two
    for (var i = 0; i < bks.length - 1; i++) {
        for (var j = i + 1; j < bks.length; j++) {
            var b0 = getBlockFromID(bks[i])
            var b1 = getBlockFromID(bks[j])
            // check block distance
            var d = dist(b0.position.x, b0.position.y, b1.position.x, b1.position.y)
            if (d < BLOCK_RADIUS * 3.47) {
                conns.push([b0.id, b1.id])
            }
        }
    }
    createGroup(bks, conns)
}

function createGroup(bks, conns) {
    // console.log('create group', bks, conns)

    var result = []

    var createdArr = []
    var gid
    conns.map(function (conn) {
        var b0 = getBlockFromID(conn[0])
        var b1 = getBlockFromID(conn[1])
        var bi0 = getGroupByBlockIndex(b0.id)
        var bi1 = getGroupByBlockIndex(b1.id)
        // console.log(b0, b1, bi0, bi1)
        if (bi0 === -1 && bi1 === -1) { // neither is defined
            gid = groups.length
            createdArr.push(gid)
            groups.push({
                blocks: [b0.id, b1.id],
                connections: []
            })
            bks = bks.filter(function (bid) {
                return bid !== b0.id && bid !== b1.id
            })
        }
        else if (bi0 === -1 || bi1 === -1) { // one is undefined
            if (bi0 < 0) {
                gid = bi1
                groups[gid].blocks.push(b0.id)
                bks = bks.filter(function (bid) {
                    return bid !== b0.id
                })
            }
            else {
                gid = bi0
                groups[gid].blocks.push(b1.id)
                bks = bks.filter(function (bid) {
                    return bid !== b1.id
                })
            }
        }
        else if (bi0 !== bi1) { // merge group
            var gidFrom
            if (bi0 < bi1) {
                gidFrom = bi1
                gid = bi0
            }
            else {
                gid = bi1
                gidFrom = bi0
            }
            groups[gid].blocks = groups[gid].blocks.concat(groups[gidFrom].blocks)
            groups[gid].connections = groups[gid].connections.concat(groups[gidFrom].connections)
            groups.splice(gidFrom, 1)
            createdArr.splice(createdArr.indexOf(gidFrom), 1)
        }
        // add connections
        groups[gid].connections.push([b0.id, b1.id])
        createConnection(b0, b1)
    })

    // generate group points for groups
    createdArr.map(function (g) {
        generateGroupPts(g)
        // console.log('create a new body', groups[g].pts)
        // add group to the world
        var comp = generatePolygonFromVertices(groups[g].pts)
        groups[g].poly = comp
        var parts = []
        groups[g].blocks.map(function (bid) {
            var bk = getBlockFromID(bid)
            Body.setStatic(bk, false)
            parts.push(bk)
        })
        Body.setParts(comp, parts, false)

        result.push(comp)
    })

    // create group points for singles
    // console.log('single blocks', bks)
    bks.map(function (bid) {
        var bk = getBlockFromID(bid)
        // console.log('bk', bk)
        // add group to the world
        var comp = generatePolygonFromVertices(bk.vertices)
        // console.log('comp', comp)
        groups.push({
            poly: comp,
            blocks: [bid],
            connections: []
        })
        var gid = groups.length - 1
        generateGroupPts(gid)
        Body.setStatic(bk, false)
        Body.setParts(comp, [bk], false)
        result.push(comp)
    })
    if (SETTINGS.global.debugMode) {
        console.log('Groups:', groups)
        console.log('World', bodies)
    }
    return result
}

function analyzingConnections(conns) {
    var sets = []
    for (var i = 0; i < conns.length; i++) {
        var conn = conns[i]
        var cs0 = -1
        var cs1 = -1
        sets.map(function (s, i) {
            if (s.includes(conn[0]) && cs0 < 0) {
                cs0 = i
            }
            if (s.includes(conn[1]) && cs1 < 0) {
                cs1 = i
            }
        })
        if (cs0 < 0 && cs1 < 0) {
            sets.push([conn[0], conn[1]])
        }
        if (cs0 < 0 && cs1 >= 0 && !sets[cs1].includes(conn[0])) {
            sets[cs1].push(conn[0])
        }
        if (cs1 < 0 && cs0 >= 0 && !sets[cs0].includes(conn[1])) {
            sets[cs0].push(conn[1])
        }
        if (cs0 >= 0 && cs1 >= 0 && cs0 !== cs1) {
            sets[cs0] = sets[cs0].concat(sets[cs1])
            sets.splice(cs1, 1)
        }
    }
    return sets
}

function divideGroup(gid, bconns) {
    if (SETTINGS.global.debugMode)
        console.log('divide group ', gid, bconns)

    var filteredConns = groups[gid].connections.filter(function (c) {
        var FOUND = false
        bconns.map(function (bc) {
            if (bc[0] === c[0] && bc[1] === c[1]) {
                FOUND = true
            }
        })
        return !FOUND
    })

    // valid break connections
    var sets = analyzingConnections(filteredConns)
    if (SETTINGS.global.debugMode)
        console.log('sets', sets)

    bconns.map(function (bc) {
        var FOUND = false
        sets.map(function (s) {
            if (s.includes(bc[0]) && s.includes(bc[1])) {
                FOUND = true
            }
        })
        if (FOUND) {
            // push back invalid break connection
            filteredConns.push(bc)
        }
    })
    if (filteredConns.length === groups[gid].connections.length) {
        return
    }
    if (SETTINGS.global.debugMode)
        console.log('filtered connections', filteredConns)

    // clear block connections 
    var bks = groups[gid].blocks
    for (var j = 0; j < bks.length; j++) {
        var b = getBlockFromID(groups[gid].blocks[j])
        b.connected = [0, 0, 0, 0, 0, 0]
    }
    // remove group
    bodies = bodies.filter(function (b) {
        if (b === groups[gid].poly) {
            World.remove(engine.world, b)
            return false
        }
        return true
    })
    groups.splice(gid, 1)

    // create new groups
    var createdGroups = createGroup(bks, filteredConns)
    var centerPt = Vector.create(0, 0)
    createdGroups.map(function (g) {
        centerPt.x += g.position.x / createdGroups.length
        centerPt.y += g.position.y / createdGroups.length
    })
    createdGroups.map(function (g) {
        var force = Vector.sub(g.position, centerPt)
        Body.applyForce(g, centerPt, Vector.mult(Vector.normalise(force), 0.5))
    })
    setTimeout(function () {
        groups.map(function (g, i) {
            generateGroupPts(i)
        })
    }, 100)
}

function generateGroupPts(gid) {
    var group = groups[gid]

    var bks = group.blocks

    if (bks.length === 1) {
        var b = getBlockFromID(bks[0])
        group.pts = b.vertices
    }
    else {

        // clear pts
        group.pts = []

        // find the bottom right vector as starting point
        // then run CW to get all the points
        var brBlk = getBlockFromID(bks[0])
        for (var j = 1; j < bks.length; j++) {
            var one = getBlockFromID(bks[j])
            if (one.bounds.max.x + one.bounds.max.y > brBlk.bounds.max.x + brBlk.bounds.max.y) {
                brBlk = one
            }
        }
        // find bottom right vertice
        var brPt = brBlk.vertices[0]
        for (var p = 1; p < brBlk.vertices.length; p++) {
            var pt = brBlk.vertices[p]
            if (pt.x + pt.y > brPt.x + brPt.y) {
                brPt = pt
            }
        }
        // console.log('bottom right point', brPt, brBlk)

        // add bottom right vertice to group pts as the starting point
        group.pts.push(brPt)
        // find all vertices from the outer lines
        var currBlk = brBlk
        var currPt = brBlk.vertices[(brPt.index + 1) % BLOCK_SIDES]
        // used to not crash the app
        var counter = 0
        while (currPt !== brPt || counter > group.blocks.length * BLOCK_SIDES) {
            // check whether currPt is a connection point
            var connBlkID = currBlk.connected[currPt.index]
            group.pts.push(currPt)
            // console.log('currPt', currBlk.id, currPt.index, connBlkID)
            if (connBlkID !== 0) {
                // it's connected, move to next block
                var preBlkID = currBlk.id
                currBlk = getBlockFromID(connBlkID)
                for (var c = 0; c < BLOCK_SIDES; c++) {
                    if (currBlk.connected[c] === preBlkID) {
                        currPt = currBlk.vertices[(c + 2) % BLOCK_SIDES]
                        break
                    }
                }
            }
            else {
                // not connected, move to next vertice
                currPt = currBlk.vertices[(currPt.index + 1) % BLOCK_SIDES]
            }
            counter++
        }
        if (counter > group.blocks.length * BLOCK_SIDES) {
            if (SETTINGS.global.debugMode)
                console.warn('Could not find group pts')
            group.pts = []
        }
    }
    // console.log(group)
    // group.innerpts = hmpoly.createPaddingPolygon(group.pts, BLOCK_RADIUS)
}

/* CONNECTIONS */

function createConnection(b0, b1) {
    // console.log('create connection with', b0.id, b1.id)
    for (var i = 0; i < b0.vertices.length; i++) {
        var v0 = b0.vertices[i]
        var v1 = b0.vertices[(i + 1) % b0.vertices.length]
        var lineIntersect = lineSegmentsIntersect(b0.position, b1.position, v0, v1)
        if (lineIntersect) {
            b0.connected[i] = b1.id
            break
        }
    }
    for (var j = 0; j < b1.vertices.length; j++) {
        var v0 = b1.vertices[j]
        var v1 = b1.vertices[(j + 1) % b1.vertices.length]
        var lineIntersect = lineSegmentsIntersect(b0.position, b1.position, v0, v1)
        if (lineIntersect) {
            b1.connected[j] = b0.id
            break
        }
    }
}

/* BLOCKS */

function getBlockFromID(id) {
    for (var i = 0; i < blocks.length; i++) {
        if (blocks[i].id === id) {
            return blocks[i]
        }
    }
    return null
}

function generateBlock(x, y, s) {
    var block = Bodies.polygon(x, y, BLOCK_SIDES, s)
    return block
}

function generatePolygonFromVertices(vts) {
    var cx = 0
    var cy = 0
    var pts = vts.map(function (vt) {
        cx += vt.x
        cy += vt.y
        return {
            x: vt.x,
            y: vt.y
        }
    })
    cx /= vts.length
    cy /= vts.length
    var body = Bodies.fromVertices(cx, cy, pts, {
        friction: SETTINGS.blocks.friction,
        frictionAir: SETTINGS.blocks.frictionAir,
    }, false)
    body.pts = pts
    World.add(engine.world, body)
    bodies.push(body)
    return body
}

/* UTILITIES */

function pointInsidePolygon(vs, pt) {
    var inside = false
    for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        var xi = vs[i].x, yi = vs[i].y
        var xj = vs[j].x, yj = vs[j].y

        var intersect = ((yi > pt.y) != (yj > pt.y))
            && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)
        if (intersect) inside = !inside
    }
    return inside
}

// Checks if two line segments intersects
function lineSegmentsIntersect(p1, p2, q1, q2) {
    var dx = p2.x - p1.x
    var dy = p2.y - p1.y
    var da = q2.x - q1.x
    var db = q2.y - q1.y

    // segments are parallel
    if ((da * dy - db * dx) === 0) {
        return false
    }

    var s = (dx * (q1.y - p1.y) + dy * (p1.x - q1.x)) / (da * dy - db * dx)
    var t = (da * (p1.y - q1.y) + db * (q1.x - p1.x)) / (db * dx - da * dy)

    return (s >= 0 && s <= 1 && t >= 0 && t <= 1)
}