/* SETUP */

// Global
const BLOCK_RADIUS = 24
const BLOCK_SIDES = 6
const TOTAL_BLOCK = 6

// PIXI
const app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    antialias: true,
    autoResize: true,
    resolution: window.devicePixelRatio
})
document.body.appendChild(app.view)
const graphics = new PIXI.Graphics()
app.stage.addChild(graphics)

// dbclick
app.view.addEventListener("dblclick", doubleClicked)

// MatterJS
let bodies = [] //bodies in matter world
// setup matter world
const engine = Matter.Engine.create()
engine.world.gravity.y = 0
engine.world.gravity.scale = 0
Matter.Engine.run(engine)
// add mouse interaction
const mouse = Matter.Mouse.create(app.view)
const mouseConstraints = Matter.MouseConstraint.create(engine, {
    mouse: mouse
})
mouse.pixelRatio = window.devicePixelRatio
Matter.World.add(
    engine.world,
    mouseConstraints
)
Matter.Events.on(mouseConstraints, 'mousedown', function () {
    onMouseDownEvent()
})
Matter.Events.on(mouseConstraints, 'mousemove', function () {
    onMouseMoveEvent()
})
Matter.Events.on(mouseConstraints, 'mouseup', function () {
    onMouseUpEvent()
})
// add collision event
let collisionTimeout // trigger end of collision
Matter.Events.on(engine, "collisionEnd", function (e) {
    if (collisionTimeout) {
        clearTimeout(collisionTimeout)
        collisionTimeout = null
    }
    collisionTimeout = setTimeout(function () {
        //end of collision
        onCollisionEndEvent()
    }, 200)
})

// Sims
let blocks = [] // hexgon blocks
let groups = [] // data structure for block groups
let connections = []
let mouseLines = []
let currDragging
let currShadow = { opacity: 0 } //todo, rename
let target = {} //todo, rename

// STATS 
const stats = new Stats()
stats.showPanel(0) // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom)

// Dat GUI 
const SETTINGS = {
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
const gui = new dat.GUI()
gui.add(SETTINGS.global, 'resetGame')
gui.add(SETTINGS.global, 'clearCanvas')
gui.add(SETTINGS.global, 'debugMode')
const gui_blocks = gui.addFolder('Blocks')
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


// add walls
Matter.World.add(engine.world, [
    Matter.Bodies.rectangle(app.screen.width / 2, -20, app.screen.width, 40, { isStatic: true }), //top
    Matter.Bodies.rectangle(app.screen.width / 2, app.screen.height + 20, app.screen.width, 40, { isStatic: true }), //bottom
    Matter.Bodies.rectangle(app.screen.width + 20, app.screen.height / 2, 40, app.screen.height, { isStatic: true }), //right
    Matter.Bodies.rectangle(-20, app.screen.height / 2, 40, app.screen.height, { isStatic: true }) //left
])
initializeBlocks()

/* Render */
app.ticker.add((delta) => {
    stats.begin()

    graphics.clear()
    if (currDragging) {
        let currGroup = getGroupByMatterBody(currDragging)
        target.group = detectSnappingGroup()
        if (target.group) {
            if (SETTINGS.global.debugMode) {
                drawSpikes(currGroup.spikes)
                drawMatchingEdge(currGroup, target.group)
            }
            currShadow.opacity += (0.25 - currShadow.opacity) * 0.2
            updateTargetShadow(currGroup, target.group)
        }
        else {
            currShadow.opacity += (0 - currShadow.opacity) * 0.2
        }
    }
    drawTargetShadow()
    drawBlocks()
    if (SETTINGS.global.debugMode) {
        drawConnections()
    }
    drawMouseLine()

    stats.end()
})

/* FUNCTIONS */

function clearCanvas() {
    bodies.map(b => {
        Matter.World.remove(engine.world, b, true)
    })
    bodies = []
    blocks = []
    groups = []
}

function initializeBlocks() {
    // add hexgons
    for (let i = 0; i < TOTAL_BLOCK; i++) {
        // generate a new block and keep them centered
        let alt = i % 2 * 2 - 1 // -1 or 1
        let block = generateBlock(app.screen.width / 2 + (i - TOTAL_BLOCK / 2) * BLOCK_RADIUS * 1.732, app.screen.height / 2 + alt * BLOCK_RADIUS * 1.5, BLOCK_RADIUS * 2)
        blocks.push(block)
    }
    initializeGroups()
}


function detectSnappingGroup() {
    let currGroup
    let result
    if (currDragging) {
        // generate spikes for current dragging group
        groups.map(function (g) {
            if (currDragging === g.poly) {
                currGroup = g
                g.spikes = []
                for (let i = 0; i < g.pts.length; i++) {
                    let ii = (i + 1) % g.pts.length
                    let centerPt = Matter.Vector.mult(Matter.Vector.add(g.pts[i], g.pts[ii]), 0.5)
                    let farPt = Matter.Vector.add(centerPt, Matter.Vector.mult(Matter.Vector.sub(centerPt, g.pts[ii].body.position), 0.88))
                    g.spikes.push([centerPt, farPt, false, g.pts[i], g.pts[ii]])
                }
            }
        })

        // finding intersacting group
        for (let i = 0; i < groups.length; i++) {
            let g = groups[i]
            if (g === currGroup) {
                continue
            }
            let FOUND = false
            let minDistance = 1000
            currGroup.spikes.map(function (sp, spi) {
                let spii = (spi + 1) % currGroup.spikes.length
                if (pointInsidePolygon(g.pts, sp[1])) {
                    sp[2] = true
                    FOUND = true

                    // find the matching line
                    let p0 = sp[3]
                    let p1 = sp[4]
                    let m0 = Matter.Vector.div(Matter.Vector.add(p0, p1), 2)
                    for (let j = 0; j < g.pts.length; j++) {
                        let jj = (j + 1) % g.pts.length
                        let p2 = g.pts[j]
                        let p3 = g.pts[jj]
                        let m1 = Matter.Vector.div(Matter.Vector.add(p2, p3), 2)
                        let d = Matter.Vector.magnitude(Matter.Vector.sub(m0, m1))
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
    spikes.map(function (sp) {
        if (sp[2]) {
            graphics.lineStyle(1, 0xFF0000, 0.5)
        }
        else {
            graphics.lineStyle(1, 0x00FF00, 0.25)
        }
        graphics.moveTo(sp[0].x, sp[0].y)
        graphics.lineTo(sp[1].x, sp[1].y)
    })
}

function drawMatchingEdge(cg, tg) {
    let p0 = cg.pts[cg.intersectings[0]]
    let p1 = cg.pts[cg.intersectings[1]]
    let p2 = tg.pts[tg.intersectings[0]]
    let p3 = tg.pts[tg.intersectings[1]]
    graphics.lineStyle(4, 0x0000FF, 0.5)
    graphics.moveTo(p0.x, p0.y)
    graphics.lineTo(p1.x, p1.y)
    graphics.moveTo(p2.x, p2.y)
    graphics.lineTo(p3.x, p3.y)
}

function updateTargetShadow(cg, tg) {
    let p0 = Matter.Vector.create(cg.pts[cg.intersectings[0]].x, cg.pts[cg.intersectings[0]].y)
    let p1 = Matter.Vector.create(cg.pts[cg.intersectings[1]].x, cg.pts[cg.intersectings[1]].y)
    let p2 = Matter.Vector.create(tg.pts[tg.intersectings[0]].x, tg.pts[tg.intersectings[0]].y)
    let p3 = Matter.Vector.create(tg.pts[tg.intersectings[1]].x, tg.pts[tg.intersectings[1]].y)
    let l0 = Matter.Vector.normalise(Matter.Vector.sub(p0, p1))
    let l1 = Matter.Vector.normalise(Matter.Vector.sub(p3, p2))
    target.angle = Math.atan2(Matter.Vector.cross(l0, l1), Matter.Vector.dot(l0, l1))
    Matter.Vertices.rotate([p0, p1], target.angle, cg.poly.position)
    let mp0 = Matter.Vector.div(Matter.Vector.add(p0, p1), 2)
    let mp1 = Matter.Vector.div(Matter.Vector.add(p2, p3), 2)
    target.offset = Matter.Vector.sub(mp1, mp0)
    target.cg = cg //todo, merge with group
}

function drawTargetShadow() {
    if (currShadow.opacity > 0) {
        graphics.lineStyle(0)
        graphics.beginFill(0xFFFFFF, currShadow.opacity)
        target.cg.poly.parts.filter(function (part, i) {
            return i !== 0
        }).map(function (p) {
            let vCopy = p.vertices.map(function (v) {
                return {
                    x: v.x,
                    y: v.y
                }
            })
            if (target.angle !== 0) {
                Matter.Vertices.rotate(vCopy, target.angle, target.cg.poly.position)
            }
            Matter.Vertices.translate(vCopy, target.offset)
            let vertices = Matter.Vertices.chamfer(vCopy, SETTINGS.blocks.cornerRadius, -1, 2, 14)
            const path = vertices.reduce((a, c) => a.concat([c.x, c.y]), [])
            graphics.drawPolygon(path)
        })
        graphics.endFill()
    }
}

function drawBlocks() {
    for (let i = 0; i < blocks.length; i++) {
        let one = blocks[i]
        // update round radius
        let vertices = Matter.Vertices.chamfer(one.vertices, SETTINGS.blocks.cornerRadius, -1, 2, 14) //default chamfer
        // draw block
        const path = vertices.reduce((a, c) => a.concat([c.x, c.y]), [])
        graphics.lineStyle(0)
        if (one.isHighlighted) {
            graphics.beginFill(0xF08080, 1)
        }
        else {
            graphics.beginFill(0xF0F0F0, 1)
        }
        graphics.drawPolygon(path)
        graphics.endFill()

        if (SETTINGS.global.debugMode) {
            // draw angle indicator
            let midPoint = {
                x: one.vertices[0].x / 2 + one.vertices[one.vertices.length - 1].x / 2,
                y: one.vertices[0].y / 2 + one.vertices[one.vertices.length - 1].y / 2
            }
            graphics.lineStyle(1, 0xEB4034, 0.25)
            graphics.moveTo(one.position.x, one.position.y)
            graphics.lineTo(one.position.x + (midPoint.x - one.position.x) * 0.88, one.position.y + (midPoint.y - one.position.y) * 0.88)
        }
    }
}

function drawGroupAreas() {
    for (let i = 0; i < groups.length; i++) {
        if (!groups[i].innerpts) {
            return
        }
        stroke(0, 0, 255, 64)
        strokeWeight(1)
        fill(255, 255, 0, 64)
        beginShape()
        for (let j = 0; j < groups[i].innerpts.length; j++) {
            let ver = groups[i].innerpts[j]
            vertex(ver.x, ver.y)
        }
        endShape(CLOSE)
        for (let j = 0; j < groups[i].innerpts.length; j++) {
            let ver = groups[i].innerpts[j]
            fill(255, 0, 0)
            noStroke()
            ellipse(ver.x, ver.y, 4, 4)
            vertex(ver.x, ver.y)
        }
    }
}

function drawConnections() {
    graphics.lineStyle(4, 0x00FF00, 0.25)
    for (let i = 0; i < groups.length; i++) {
        let connections = groups[i].connections
        for (let j = 0; j < connections.length; j++) {
            let b0 = getBlockFromID(connections[j][0])
            let b1 = getBlockFromID(connections[j][1])
            graphics.moveTo(b0.position.x, b0.position.y)
            graphics.lineTo(b1.position.x, b1.position.y)
        }
    }
}

function drawMouseLine() {
    if (mouseLines.length < 2) {
        return
    }

    // draw stroke
    let drawingPath = []
    let prevPoint = mouseLines[0]
    drawingPath.push(prevPoint.x, prevPoint.y)
    for (let n = 1; n < mouseLines.length; n++) {
        let currPoint = mouseLines[n]
        let delta = Matter.Vector.sub(currPoint, prevPoint)
        let midPoint = Matter.Vector.div(Matter.Vector.add(currPoint, prevPoint), 2)
        let step = Matter.Vector.rotate(Matter.Vector.div(delta, 10), 0.75)
        let top = Matter.Vector.add(midPoint, step)
        let bottom = Matter.Vector.sub(midPoint, step)
        drawingPath.push(top.x, top.y)
        drawingPath.unshift(bottom.x, bottom.y)
        prevPoint = currPoint
    }
    graphics.lineStyle(4, 0xFF4040, 1)
    graphics.beginFill(0xFF4040, 1)
    graphics.drawPolygon(drawingPath)
    graphics.endFill()
}

function updateAfterMouseDrag() {
    if (mouseLines.length < 2) {
        return
    }
    // get first group that got connections broken
    let gid = -1
    let brokenConns = []
    for (let i = 1; i < mouseLines.length; i++) {
        if (gid < 0) {
            for (let j = 0; j < groups.length; j++) {
                let INTERSECTED = false
                for (let m = 0; m < groups[j].connections.length; m++) {
                    let b0 = getBlockFromID(groups[j].connections[m][0])
                    let b1 = getBlockFromID(groups[j].connections[m][1])
                    let lineIntersect = lineSegmentsIntersect(b0.position, b1.position, mouseLines[i - 1], mouseLines[i])
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
            for (let m = 0; m < groups[gid].connections.length; m++) {
                let b0 = getBlockFromID(groups[gid].connections[m][0])
                let b1 = getBlockFromID(groups[gid].connections[m][1])
                let lineIntersect = lineSegmentsIntersect(b0.position, b1.position, mouseLines[i - 1], mouseLines[i])
                if (lineIntersect) {
                    let filteredBC = brokenConns.filter(function (p) {
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
let pMousePosition
let mouseStartOnDrag
function onMouseDownEvent() {
    // console.log('mouse down', engine.world.bodies)
    pMousePosition = Matter.Vector.clone(mouse.position)

    if (mouseConstraints.body) {
        currDragging = mouseConstraints.body
        currShadow.opacity = 0
        return
    }
    mouseStartOnDrag = true
    mouseLines.push({ ...mouse.position })

    bodies.map(function (b) {
        Matter.Body.setStatic(b, true)
    })
}

function onMouseMoveEvent() {
    // console.log('mouse move')
    if (mouseStartOnDrag) {
        mouseLines.push({ ...mouse.position })
        return
    }
    if (currDragging) {
        // update block angle on dragging
        // angle = atan2(cross(a,b), dot(a,b))
        let currDraggingOffset = Matter.Vector.sub(mouse.position, currDragging.position)
        let mouseDelta = Matter.Vector.sub(mouse.position, pMousePosition)
        // let addedVec = Matter.Vector.add(currDraggingOffset, Matter.Vector.mult(mouseDelta, Matter.Vector.magnitude(currDraggingOffset) / BLOCK_RADIUS / currDragging.parts.length))
        // let rotationAngle = Math.atan2(Matter.Vector.cross(currDraggingOffset, addedVec), Matter.Vector.dot(currDraggingOffset, addedVec))
        // Matter.Body.setAngle(currDragging, currDragging.angle + rotationAngle)
        Matter.Body.applyForce(currDragging, pMousePosition, Matter.Vector.mult(Matter.Vector.normalise(mouseDelta), Matter.Vector.magnitude(currDraggingOffset) / currDragging.parts.length / 256))
        pMousePosition = Matter.Vector.clone(mouse.position)

        return
    }
    bodies.map(function (b) {
        b.parts.map(p => p.isHighlighted = false)
        // highlight group polygon if on hover
        if (Matter.Bounds.contains(b.bounds, mouse.position)) {
            for (let i = 1; i < b.parts.length; i++) {
                let part = b.parts[i]
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
        mouseLines.push({ ...mouse.position })
        mouseStartOnDrag = false
        updateAfterMouseDrag()
        mouseLines = []

        // set group non static
        bodies.map(function (b) {
            Matter.Body.setStatic(b, false)
        })
    }

    if (currDragging) {
        if (target.group) {
            let currGroup = getGroupByMatterBody(currDragging)
            // console.log(currGroup, target.group)
            Matter.Body.rotate(currDragging, target.angle)
            Matter.Body.translate(currDragging, target.offset)
            // update group
            let bks = currGroup.blocks.concat(target.group.blocks)
            bodies = bodies.filter(function (b) {
                if (b === target.group.poly || b === currGroup.poly) {
                    Matter.World.remove(engine.world, b)
                    return false
                }
                return true
            })
            groups.splice(getGroupIndex(currGroup), 1)
            groups.splice(getGroupIndex(target.group), 1)
            formGroupByLocation(bks)
            // target.group = null
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

function onCollisionEndEvent() {
    groups.map(function (g, i) {
        generateGroupPts(i)
    })
}

function doubleClicked() {
    let mouseInsideGroups = false
    bodies.map(function (b) {
        if (Matter.Bounds.contains(b.bounds, mouse.position)) {
            mouseInsideGroups = true
        }
    })
    if (!mouseInsideGroups) {
        let block = generateBlock(mouse.position.x, mouse.position.y, BLOCK_RADIUS * 2)
        blocks.push(block)
        formGroupByLocation([block.id])
    }
}

/* GROUPS */

function getGroupByBlockIndex(bid) {
    for (let i = 0; i < groups.length; i++) {
        if (groups[i].blocks.includes(bid)) {
            return i
        }
    }
    return -1
}

function getGroupIndex(group) {
    let result
    for (let i = 0; i < groups.length; i++) {
        if (groups[i] === group) {
            result = i
            break
        }
    }
    return result
}

function getGroupByMatterBody(bd) {
    let result
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
    let bks = []
    // create connection array for each block
    for (let r = 0; r < blocks.length; r++) {
        bks.push(blocks[r].id)
    }
    formGroupByLocation(bks)
}

function formGroupByLocation(bks) {
    let conns = []
    // clear block connected array
    for (let i = 0; i < bks.length; i++) {
        getBlockFromID(bks[i]).connected = [0, 0, 0, 0, 0, 0]
    }

    // loop combination of two
    for (let i = 0; i < bks.length - 1; i++) {
        for (let j = i + 1; j < bks.length; j++) {
            let b0 = getBlockFromID(bks[i])
            let b1 = getBlockFromID(bks[j])
            // check block distance
            let d = Matter.Vector.magnitude(Matter.Vector.sub(b0.position, b1.position))
            if (d < BLOCK_RADIUS * 3.47) {
                conns.push([b0.id, b1.id])
            }
        }
    }
    createGroup(bks, conns)
}

function createGroup(bks, conns) {
    // console.log('create group', bks, conns)

    let result = []

    let createdArr = []
    let gid
    conns.map(function (conn) {
        let b0 = getBlockFromID(conn[0])
        let b1 = getBlockFromID(conn[1])
        let bi0 = getGroupByBlockIndex(b0.id)
        let bi1 = getGroupByBlockIndex(b1.id)
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
            let gidFrom
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
        let comp = generatePolygonFromVertices(groups[g].pts)
        groups[g].poly = comp
        let parts = []
        groups[g].blocks.map(function (bid) {
            let bk = getBlockFromID(bid)
            Matter.Body.setStatic(bk, false)
            parts.push(bk)
        })
        Matter.Body.setParts(comp, parts, false)

        result.push(comp)
    })

    // create group points for singles
    // console.log('single blocks', bks)
    bks.map(function (bid) {
        let bk = getBlockFromID(bid)
        // console.log('bk', bk)
        // add group to the world
        let comp = generatePolygonFromVertices(bk.vertices)
        // console.log('comp', comp)
        groups.push({
            poly: comp,
            blocks: [bid],
            connections: []
        })
        let gid = groups.length - 1
        generateGroupPts(gid)
        Matter.Body.setStatic(bk, false)
        Matter.Body.setParts(comp, [bk], false)
        result.push(comp)
    })
    if (SETTINGS.global.debugMode) {
        console.log('Groups:', groups)
        console.log('World', bodies)
    }
    return result
}

function analyzingConnections(conns) {
    let sets = []
    for (let i = 0; i < conns.length; i++) {
        let conn = conns[i]
        let cs0 = -1
        let cs1 = -1
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

    let filteredConns = groups[gid].connections.filter(function (c) {
        let FOUND = false
        bconns.map(function (bc) {
            if (bc[0] === c[0] && bc[1] === c[1]) {
                FOUND = true
            }
        })
        return !FOUND
    })

    // valid break connections
    let sets = analyzingConnections(filteredConns)
    if (SETTINGS.global.debugMode)
        console.log('sets', sets)

    bconns.map(function (bc) {
        let FOUND = false
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
    let bks = groups[gid].blocks
    for (let j = 0; j < bks.length; j++) {
        let b = getBlockFromID(groups[gid].blocks[j])
        b.connected = [0, 0, 0, 0, 0, 0]
    }
    // remove group
    bodies = bodies.filter(function (b) {
        if (b === groups[gid].poly) {
            Matter.World.remove(engine.world, b)
            return false
        }
        return true
    })
    groups.splice(gid, 1)

    // create new groups
    let createdGroups = createGroup(bks, filteredConns)
    let centerPt = Matter.Vector.create(0, 0)
    createdGroups.map(function (g) {
        centerPt.x += g.position.x / createdGroups.length
        centerPt.y += g.position.y / createdGroups.length
    })
    createdGroups.map(function (g) {
        let force = Matter.Vector.sub(g.position, centerPt)
        Matter.Body.applyForce(g, centerPt, Matter.Vector.mult(Matter.Vector.normalise(force), 0.5))
    })
    setTimeout(function () {
        groups.map(function (g, i) {
            generateGroupPts(i)
        })
    }, 100)
}

function generateGroupPts(gid) {
    let group = groups[gid]

    let bks = group.blocks

    if (bks.length === 1) {
        let b = getBlockFromID(bks[0])
        group.pts = b.vertices
    }
    else {

        // clear pts
        group.pts = []

        // find the bottom right vector as starting point
        // then run CW to get all the points
        let brBlk = getBlockFromID(bks[0])
        for (let j = 1; j < bks.length; j++) {
            let one = getBlockFromID(bks[j])
            if (one.bounds.max.x + one.bounds.max.y > brBlk.bounds.max.x + brBlk.bounds.max.y) {
                brBlk = one
            }
        }
        // find bottom right vertice
        let brPt = brBlk.vertices[0]
        for (let p = 1; p < brBlk.vertices.length; p++) {
            let pt = brBlk.vertices[p]
            if (pt.x + pt.y > brPt.x + brPt.y) {
                brPt = pt
            }
        }
        // console.log('bottom right point', brPt, brBlk)

        // add bottom right vertice to group pts as the starting point
        group.pts.push(brPt)
        // find all vertices from the outer lines
        let currBlk = brBlk
        let currPt = brBlk.vertices[(brPt.index + 1) % BLOCK_SIDES]
        // used to not crash the app
        let counter = 0
        while (currPt !== brPt || counter > group.blocks.length * BLOCK_SIDES) {
            // check whether currPt is a connection point
            let connBlkID = currBlk.connected[currPt.index]
            group.pts.push(currPt)
            // console.log('currPt', currBlk.id, currPt.index, connBlkID)
            if (connBlkID !== 0) {
                // it's connected, move to next block
                let preBlkID = currBlk.id
                currBlk = getBlockFromID(connBlkID)
                for (let c = 0; c < BLOCK_SIDES; c++) {
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
    for (let i = 0; i < b0.vertices.length; i++) {
        let v0 = b0.vertices[i]
        let v1 = b0.vertices[(i + 1) % b0.vertices.length]
        let lineIntersect = lineSegmentsIntersect(b0.position, b1.position, v0, v1)
        if (lineIntersect) {
            b0.connected[i] = b1.id
            break
        }
    }
    for (let j = 0; j < b1.vertices.length; j++) {
        let v0 = b1.vertices[j]
        let v1 = b1.vertices[(j + 1) % b1.vertices.length]
        let lineIntersect = lineSegmentsIntersect(b0.position, b1.position, v0, v1)
        if (lineIntersect) {
            b1.connected[j] = b0.id
            break
        }
    }
}

/* BLOCKS */

function getBlockFromID(id) {
    for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].id === id) {
            return blocks[i]
        }
    }
    return null
}

function generateBlock(x, y, s) {
    let block = Matter.Bodies.polygon(x, y, BLOCK_SIDES, s)
    return block
}

function generatePolygonFromVertices(vts) {
    let cx = 0
    let cy = 0
    let pts = vts.map(function (vt) {
        cx += vt.x
        cy += vt.y
        return {
            x: vt.x,
            y: vt.y
        }
    })
    cx /= vts.length
    cy /= vts.length
    let body = Matter.Bodies.fromVertices(cx, cy, pts, {
        friction: SETTINGS.blocks.friction,
        frictionAir: SETTINGS.blocks.frictionAir,
    }, false)
    body.pts = pts
    Matter.World.add(engine.world, body)
    bodies.push(body)
    return body
}

/* UTILITIES */

function pointInsidePolygon(vs, pt) {
    let inside = false
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        let xi = vs[i].x, yi = vs[i].y
        let xj = vs[j].x, yj = vs[j].y

        let intersect = ((yi > pt.y) != (yj > pt.y))
            && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)
        if (intersect) inside = !inside
    }
    return inside
}

// Checks if two line segments intersects
function lineSegmentsIntersect(p1, p2, q1, q2) {
    let dx = p2.x - p1.x
    let dy = p2.y - p1.y
    let da = q2.x - q1.x
    let db = q2.y - q1.y

    // segments are parallel
    if ((da * dy - db * dx) === 0) {
        return false
    }

    let s = (dx * (q1.y - p1.y) + dy * (p1.x - q1.x)) / (da * dy - db * dx)
    let t = (da * (p1.y - q1.y) + db * (q1.x - p1.x)) / (db * dx - da * dy)

    return (s >= 0 && s <= 1 && t >= 0 && t <= 1)
}

// function setup() {
//     let canvas = createCanvas(app.screen.width, app.screen.height)
// }

// function draw() {
//     smooth()
//     background(0)
// }

/* RENDER */

/* Target Shadow */