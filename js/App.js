/* SETUP */

// Global
const BLOCK_RADIUS = 24
const BLOCK_SIDES = 6
const TOTAL_BLOCK = 6
let frameCount = 0

// Shaders
const vertexSrc = `
    precision mediump float;
    attribute vec2 aVertexPosition;

    uniform mat3 translationMatrix;
    uniform mat3 projectionMatrix;

    void main() {
        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    }
`

const fragmentSrc = `
    precision mediump float;
    const float PI_6 = 0.5235987755982988;
    const float PI_3 = 1.0471975511965976;
    const vec3 BG_COLOR = vec3(0.88);
    const float PIXEL_RATIO = 2.0;

    uniform float u_radius;
    uniform float u_angle; //angle
    uniform vec2 u_pos; //position
    uniform vec4 u_leds[6]; // leds 

    float map(float value, float inMin, float inMax, float outMin, float outMax) {
        float newValue = outMin + (outMax - outMin) * (value - inMin) / (inMax - inMin);
        if (outMin < outMax) {
            return clamp(newValue, outMin, outMax);
        } else {
            return clamp(newValue, outMax, outMin);
        }
    }

    float getAbsoluteAngle(vec2 v1, vec2 v2) {
        vec2 diff = v2 - v1;
        return atan(diff.y / diff.x);
    }

    float getRelativeAngle(vec2 v1, vec2 v2) {
        return acos(dot(v1, v2) / length(v1) / length(v2));
    }

    float blendOverlay(float base, float blend) {
        return base<0.5?(2.0*base*blend):(1.0-2.0*(1.0-base)*(1.0-blend));
    }
    vec3 blendOverlay(vec3 base, vec3 blend) {
        return vec3(blendOverlay(base.r,blend.r),blendOverlay(base.g,blend.g),blendOverlay(base.b,blend.b));
    }
    vec3 blendColors(vec3 base, vec3 blend, float opacity, int mode) {
        // https://github.com/jamieowen/glsl-blend/
        if(mode == 0) {
            return blend * opacity + base * (1.0 - opacity); // blend nomral
        }
        if(mode == 1) {
            return blendOverlay(base, blend) * opacity + base * (1.0 - opacity); // blend overlay
        }
        if(mode == 2) {
            return min(base+blend,vec3(1.0)) * opacity + base * (1.0 - opacity); // blend add
        }
        if(mode == 3) {
            return vec3(max(base.r,blend.r),max(base.g,blend.g),max(base.b,blend.b)) * opacity + base * (1.0 - opacity); // blend lighten
        }
        if(mode == 4) {
            return vec3(min(base.r,blend.r),min(base.g,blend.g),min(base.b,blend.b)) * opacity + base * (1.0 - opacity); // blend darken
        }
        if(mode == 5) {
            return base*blend * opacity + base * (1.0 - opacity); // blend multiply
        }
    }

    void main() {
        // set to default color
        gl_FragColor = vec4(BG_COLOR, 1.0);
        vec2 fragCoord = gl_FragCoord.xy / PIXEL_RATIO;

        vec3 color = vec3(-1);
        for(int i = 0; i < 6; i ++)  {
            float angle = u_angle + PI_3 * float(i);
            float px = u_pos.x + cos(angle) * u_radius * 2.0;
            float py = u_pos.y - sin(angle) * u_radius * 2.0;
            float dc = distance(fragCoord.xy, u_pos.xy); // distance to center
            float ac = degrees(getAbsoluteAngle(u_pos, fragCoord.xy) + u_angle); // angle to center
            float d = distance(fragCoord.xy, vec2(px, py)); 
            float block_border_pram = abs(30.0 - mod(ac, 60.0)) / 150.0 * u_radius;
            // float a = degrees(getRelativeAngle((fragCoord.xy - u_pos), (vec2(px, py) - u_pos))); // angle to center
            if(dc < u_radius * 3.2 - block_border_pram) { //color spread distance, generate the border
                // if(d < u_radius * 3.0 && abs(a) < 30.0 ){ // covers the triangluar inner area
                if(d < u_radius * 3.0){
                    float upper_value = u_radius * 3.0 * u_leds[i].a;
                    // if(abs(a) >= 30.0) {
                    //     upper_value = u_radius * 3.0 * u_leds[i].a * 0.9;
                    // }
                    float o = map(d, 0.0, upper_value, 1.0, 0.0);
                    if(color.r < 0.0) {
                        color = blendColors(vec3(1.0), u_leds[i].rgb, o, 5); 
                    }
                    else {
                        color = blendColors(color, u_leds[i].rgb, o, 5);
                    }
                }
            }
        }
        if(color.r >= 0.0) {
            color = blendColors(color, vec3(1.0), 0.2, 3); // simulate translucent cover overlay
            gl_FragColor = vec4(color, 1.0);
        }
    }
`

// PIXI
const app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    antialias: true,
    autoResize: true,
    resolution: window.devicePixelRatio
})
document.body.appendChild(app.view)
const shaderGraphics = new PIXI.Graphics()
// app.stage.addChild(shaderGraphics)
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
let targetShadow = {}

// STATS 
const stats = new Stats()
stats.showPanel(0) // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom)

// Dat GUI 
const SETTINGS = {
    global: {
        debugMode: false,
        shaderDraw: false,
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
const shaderDrawController = gui.add(SETTINGS.global, 'shaderDraw')
shaderDrawController.onFinishChange( yesno => {
    if(yesno) {
        app.stage.addChildAt(shaderGraphics, 0)
    }
    else{
        app.stage.removeChild(shaderGraphics)
    }
})
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
// gui.close()

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
    updateTargetShadow()
    if (SETTINGS.global.debugMode && targetShadow.targetGroup) {
        drawSpikes()
        drawMatchingEdge()
    }
    drawTargetShadow()
    if(SETTINGS.global.shaderDraw) {
        drawBlocksShader()
    }
    else {
        drawBlocks()
    }
    if (SETTINGS.global.debugMode) {
        drawConnections()
    }
    drawMouseLine()

    frameCount++
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
    shaderGraphics.removeChildren()
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
    let result
    
    // generate spikes for current dragging group
    targetShadow.dragGroup.spikes = []
    for (let i = 0; i < targetShadow.dragGroup.pts.length; i++) {
        let ii = (i + 1) % targetShadow.dragGroup.pts.length
        let centerPt = Matter.Vector.mult(Matter.Vector.add(targetShadow.dragGroup.pts[i], targetShadow.dragGroup.pts[ii]), 0.5)
        let farPt = Matter.Vector.add(centerPt, Matter.Vector.mult(Matter.Vector.sub(centerPt, targetShadow.dragGroup.pts[ii].body.position), 0.88))
        targetShadow.dragGroup.spikes.push([centerPt, farPt, false, targetShadow.dragGroup.pts[i], targetShadow.dragGroup.pts[ii]])
    }

    // finding intersacting group
    for (let i = 0; i < groups.length; i++) {
        let g = groups[i]
        if (g === targetShadow.dragGroup) {
            continue
        }
        let FOUND = false
        let minDistance = 1000
        targetShadow.dragGroup.spikes.map(function (sp, spi) {
            let spii = (spi + 1) % targetShadow.dragGroup.spikes.length
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
                        targetShadow.dragGroup.intersectings = [spi, spii]
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
    return result
}

function drawSpikes() {
    targetShadow.dragGroup.spikes.map(function (sp) {
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

function drawMatchingEdge() {
    let p0 = targetShadow.dragGroup.pts[targetShadow.dragGroup.intersectings[0]]
    let p1 = targetShadow.dragGroup.pts[targetShadow.dragGroup.intersectings[1]]
    let p2 = targetShadow.targetGroup.pts[targetShadow.targetGroup.intersectings[0]]
    let p3 = targetShadow.targetGroup.pts[targetShadow.targetGroup.intersectings[1]]
    graphics.lineStyle(4, 0x0000FF, 0.5)
    graphics.moveTo(p0.x, p0.y)
    graphics.lineTo(p1.x, p1.y)
    graphics.moveTo(p2.x, p2.y)
    graphics.lineTo(p3.x, p3.y)
}

function updateTargetShadow() {
    if(!currDragging) {
        return
    }
    let dragGroup = getGroupByMatterBody(currDragging)
    targetShadow.dragGroup = dragGroup

    let targetGroup = detectSnappingGroup()
    targetShadow.targetGroup = targetGroup
    if(targetGroup) {
        let p0 = Matter.Vector.create(dragGroup.pts[dragGroup.intersectings[0]].x, dragGroup.pts[dragGroup.intersectings[0]].y)
        let p1 = Matter.Vector.create(dragGroup.pts[dragGroup.intersectings[1]].x, dragGroup.pts[dragGroup.intersectings[1]].y)
        let p2 = Matter.Vector.create(targetGroup.pts[targetGroup.intersectings[0]].x, targetGroup.pts[targetGroup.intersectings[0]].y)
        let p3 = Matter.Vector.create(targetGroup.pts[targetGroup.intersectings[1]].x, targetGroup.pts[targetGroup.intersectings[1]].y)
        let l0 = Matter.Vector.normalise(Matter.Vector.sub(p0, p1))
        let l1 = Matter.Vector.normalise(Matter.Vector.sub(p3, p2))
        targetShadow.angle = Math.atan2(Matter.Vector.cross(l0, l1), Matter.Vector.dot(l0, l1))
        Matter.Vertices.rotate([p0, p1], targetShadow.angle, dragGroup.poly.position)
        let mp0 = Matter.Vector.div(Matter.Vector.add(p0, p1), 2)
        let mp1 = Matter.Vector.div(Matter.Vector.add(p2, p3), 2)
        targetShadow.offset = Matter.Vector.sub(mp1, mp0)
        targetShadow.paths = dragGroup.poly.parts.filter(function (part, i) {
            return i !== 0
        }).map(function (p) {
            let vCopy = p.vertices.map(function (v) {
                return {
                    x: v.x,
                    y: v.y
                }
            })
            if (targetShadow.angle !== 0) {
                Matter.Vertices.rotate(vCopy, targetShadow.angle, dragGroup.poly.position)
            }
            Matter.Vertices.translate(vCopy, targetShadow.offset)
            let vertices = Matter.Vertices.chamfer(vCopy, SETTINGS.blocks.cornerRadius, -1, 2, 14)
            const path = vertices.reduce((a, c) => a.concat([c.x, c.y]), [])
            return path
        })
    }
    if (targetGroup) {
        targetShadow.opacity += (0.25 - targetShadow.opacity) * 0.2
    }
    else {
        targetShadow.opacity += (0 - targetShadow.opacity) * 0.2
    }
}

function drawTargetShadow() {
    if (targetShadow.opacity > 0) {
        graphics.lineStyle(0)
        graphics.beginFill(0xFFFFFF, targetShadow.opacity)
        targetShadow.paths.map(function (p) {
            graphics.drawPolygon(p)
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

function drawBlocksShader() {
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i]
        if( frameCount % 30 === 0) {
            if(i % 2 === 0) {
                block.colors.unshift(block.colors.pop())
            }
            else {
                block.colors.push(block.colors.shift())
            }
        }
        // get block angle
        let midPoint = {
            x: block.vertices[0].x / 2 + block.vertices[block.vertices.length - 1].x / 2,
            y: block.vertices[0].y / 2 + block.vertices[block.vertices.length - 1].y / 2
        }
        let angle = Matter.Vector.angle(block.position, midPoint)
        block.mesh.position.set(block.position.x, block.position.y)
        block.mesh.rotation = angle
        block.mesh.shader.uniforms.u_pos = [block.position.x, app.screen.height - block.position.y]
        block.mesh.shader.uniforms.u_angle = angle
        block.mesh.shader.uniforms.u_leds = block.colors.reduce((a, c) => a.concat(c), [])
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
        targetShadow.opacity = 0
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
        if (targetShadow.targetGroup) {
            // console.log(targetShadow.dragGroup, targetShadow.targetGroup)
            Matter.Body.rotate(currDragging, targetShadow.angle)
            Matter.Body.translate(currDragging, targetShadow.offset)
            // update group
            let bks = targetShadow.dragGroup.blocks.concat(targetShadow.targetGroup.blocks)
            bodies = bodies.filter(function (b) {
                if (b === targetShadow.targetGroup.poly || b === targetShadow.dragGroup.poly) {
                    Matter.World.remove(engine.world, b)
                    return false
                }
                return true
            })
            groups.splice(getGroupIndex(targetShadow.dragGroup), 1)
            groups.splice(getGroupIndex(targetShadow.targetGroup), 1)
            formGroupByLocation(bks)
            targetShadow.targetGroup = null
        }
        else {
            if (SETTINGS.global.debugMode)
                console.log("drag done")
            groups.map(function (g, i) {
                generateGroupPts(i)
            })
        }
        currDragging = null
        targetShadow.opacity = 0
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

function getGroupIndexByBlockID(bid) {
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
        let bi0 = getGroupIndexByBlockID(b0.id)
        let bi1 = getGroupIndexByBlockID(b1.id)
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
    let block = Matter.Bodies.polygon(0, 0, BLOCK_SIDES, s)
    if(Math.random() > 0.5) {
        block.colors = [
            [1.0, 0.0, 0.0, 1.0],
            [0.0, 0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0, 0.75],
            [0.0, 0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0, 0.25],
            [0.0, 0.0, 0.0, 0.0],
        ]
    }
    else {
        block.colors = [
            [1.0, 0.0, 0.0, 1.0],
            [0.0, 1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0, 1.0],
            [1.0, 0.0, 1.0, 1.0],
            [1.0, 1.0, 0.0, 1.0],
            [0.0, 1.0, 1.0, 1.0],
        ]
    }

    let vertices = Matter.Vertices.chamfer(block.vertices, 10, -1, 2, 14) //default chamfer
    const geometry = new PIXI.Geometry()
        .addAttribute(
            'aVertexPosition',
            vertices.reduce((a, c) => a.concat([c.x, c.y]), []),
            2
        )
        .addIndex([...Array(vertices.length - 2).keys()].reduce((a, c) => a.concat([0, c+1, c+2]), []))
    let shader = PIXI.Shader.from(vertexSrc, fragmentSrc, {
        u_radius: BLOCK_RADIUS / 2,
        u_angle: 0.0,
        u_pos: [x, y],
        u_leds: block.colors
    })
    block.mesh = mesh = new PIXI.Mesh(geometry, shader)
    shaderGraphics.addChild(block.mesh)
    

    Matter.Body.setPosition(block, {
        x: x,
        y: y
    })
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