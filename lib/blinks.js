function BLINKS(scope) {
    "use strict";
    return new simulation(scope);

    function simulation(scope) {
        let $ = (scope == "global" ? window : this);

        /* CONSTANTS */
        $.BLOCKSIDES = 6;
        $.BLOCKRADIUS = 24;
        $.BLOCKCORNERRADIUS = 10;
        $.BLOCKFRICTION = 0.8;
        $.BLOCKFRICTIONAIR = 0.8;


        /* PUBLIC PROPERTY */
        $.debugMode = false;
        $.pixelRatio = window.devicePixelRatio;
        $.width = window.innerWidth;
        $.height = window.innerHeight;


        /* PRIVATE PROPERTY */
        $._blocks = [] // hexgon blocks
        $._groups = [] // data structure for block groups
        $._breakLines = []
        $._currDragging = null
        $._targetShadow = {}


        /* SETUP */

        // MatterJS
        $._MatterBodies = [] //bodies in matter world
        $._MatterWalls = [] // wall boundary in matter world
        // setup matter world
        $._MatterEngine = Matter.Engine.create()
        $._MatterEngine.world.gravity.y = 0
        $._MatterEngine.world.gravity.scale = 0
        Matter.Engine.run($._MatterEngine)
        // add boundary walls
        $._createMatterWalls = function (w, h) {
            const top = Matter.Bodies.rectangle(w / 2, -20, w, 40, { isStatic: true })
            const bottom = Matter.Bodies.rectangle(w / 2, h + 20, w, 40, { isStatic: true })
            const right = Matter.Bodies.rectangle(w + 20, h / 2, 40, h, { isStatic: true })
            const left = Matter.Bodies.rectangle(-20, h / 2, 40, h, { isStatic: true })

            Matter.World.add($._MatterEngine.world, [
                top, bottom, right, left
            ])
            $._MatterWalls.push(top, bottom, right, left)
        }
        $._createMatterWalls($.width, $.height)

        // PIXI
        $._PIXI = new PIXI.Application({
            width: $.width,
            height: $.height,
            antialias: true,
            autoResize: true,
            resolution: $.pixelRatio,
            backgroundColor: 0x444444
        })
        document.body.appendChild($._PIXI.view)
        $._PIXIShadowView = new PIXI.Graphics()
        $._PIXI.stage.addChild($._PIXIShadowView)
        $._PIXIBlockView = new PIXI.Graphics()
        $._PIXI.stage.addChild($._PIXIBlockView)
        $._PIXIOverlayView = new PIXI.Graphics()
        $._PIXI.stage.addChild($._PIXIOverlayView)


        /* UPDATES */

        $._PIXI.ticker.add((delta) => {
            $._beforeFrameUpdatedFn()

            $._PIXI.stage.children.map(g => g.clear())
            // draw target shadow
            $._updateTargetShadow()
            $._drawTargetShadow()

            // draw blocks
            // $._drawBlocks()
            $._drawBlocksUsingShader()

            // draw debug views
            if ($.debugMode) {
                if ($._targetShadow.targetGroup) {
                    $._drawSpikes()
                    $._drawMatchingEdge()
                }
                $._drawConnections()
                // draw group area
                // $._drawGroupAreas()
            }

            // draw break stripes on dragging
            $._drawBreakLines()

            $._afterFrameUpdatedFn()
        })

        /* PUBLIC FUNCTIONS */

        $.clearCanvas = function () {
            // clear bodies in Matter World
            $._MatterBodies.map(b => {
                Matter.World.remove($._MatterEngine.world, b, true)
            })
            $._MatterBodies = []

            // clear blocks and groups
            $._blocks = []
            $._groups = []

            // clear pixi graphics
            $._PIXIBlockView.removeChildren()
        }

        $.resizeCanvas = function (w, h) {
            $._PIXI.renderer.resize(w, h)
            // clear walls in Matter World
            $._MatterWalls.map(w => Matter.World.remove($._MatterEngine.world, w, true))
            $._MatterWalls = []
            // create new walls
            $._createMatterWalls(w, h)
        }

        $.createBlocks = function (number) {
            // add hexgons
            for (let i = 0; i < number; i++) {
                // generate a new block and keep them centered
                let alt = i % 2 * 2 - 1 // -1 or 1
                let block = $.generateBlock($._PIXI.screen.width / 2 + (i - number / 2) * $.BLOCKRADIUS * 1.732, $._PIXI.screen.height / 2 + alt * $.BLOCKRADIUS * 1.5)
                $._blocks.push(block)
            }
            // initialize group based on newly created blocks
            $._formGroupByLocation($._blocks.map(b => b.id))
        }

        $.generateBlock = function (x, y) {
            let block = Matter.Bodies.polygon(0, 0, $.BLOCKSIDES, $.BLOCKRADIUS * 2)

            // generate random color leds
            block.colors = Array.from({ length: 6 }, () => Array.from({ length: 3 }, () => Math.random() > 0.2 ? 0.0 : 1.0))

            let vertices = Matter.Vertices.chamfer(block.vertices, $.BLOCKCORNERRADIUS, -1, 2, 14) //default chamfer
            const geometry = new PIXI.Geometry()
                .addAttribute(
                    'aVertexPosition',
                    vertices.reduce((a, c) => a.concat([c.x, c.y]), []),
                    2
                )
                .addIndex([...Array(vertices.length - 2).keys()].reduce((a, c) => a.concat([0, c + 1, c + 2]), []))
            let shader = PIXI.Shader.from(vertexSrc, fragmentSrc, {
                u_radius: $.BLOCKRADIUS / 2,
                u_angle: 0.0,
                u_pos: [x, y],
                u_leds: block.colors
            })
            block.mesh = new PIXI.Mesh(geometry, shader)
            $._PIXIBlockView.addChild(block.mesh)

            Matter.Body.setPosition(block, {
                x: x,
                y: y
            })
            return block
        }


        /* EVENTS */

        // add mouse interaction
        $._MatterMouse = Matter.Mouse.create($._PIXI.view)
        $._MatterMouse.pixelRatio = $.pixelRatio
        $._MatterMouseConstraint = Matter.MouseConstraint.create($._MatterEngine, {
            mouse: $._MatterMouse
        })
        Matter.World.add(
            $._MatterEngine.world,
            $._MatterMouseConstraint
        )
        Matter.Events.on($._MatterMouseConstraint, 'mousedown', function () {
            onMouseDownEvent()
        })
        Matter.Events.on($._MatterMouseConstraint, 'mousemove', function () {
            onMouseMoveEvent()
        })
        Matter.Events.on($._MatterMouseConstraint, 'mouseup', function () {
            onMouseUpEvent()
        })
        // add collision event
        let collisionTimeout // trigger end of collision
        Matter.Events.on($._MatterEngine, "collisionEnd", function (e) {
            if (collisionTimeout) {
                clearTimeout(collisionTimeout)
                collisionTimeout = null
            }
            collisionTimeout = setTimeout(function () {
                //end of collision
                onCollisionEndEvent()
            }, 200)
        })
        let pMousePosition
        let mouseStartOnDrag
        function onMouseDownEvent() {
            // console.log('mouse down', $._MatterEngine.world.bodies)
            pMousePosition = Matter.Vector.clone($._MatterMouse.position)

            if ($._MatterMouseConstraint.body) {
                $._currDragging = $._MatterMouseConstraint.body
                $._targetShadow.opacity = 0
                return
            }
            mouseStartOnDrag = true
            $._breakLines.push({ ...$._MatterMouse.position })

            $._MatterBodies.map(function (b) {
                Matter.Body.setStatic(b, true)
            })
        }

        function onMouseMoveEvent() {
            // console.log('mouse move')
            if (mouseStartOnDrag) {
                $._breakLines.push({ ...$._MatterMouse.position })
                return
            }
            if ($._currDragging) {
                // update block angle on dragging
                // angle = atan2(cross(a,b), dot(a,b))
                let currDraggingOffset = Matter.Vector.sub($._MatterMouse.position, $._currDragging.position)
                let mouseDelta = Matter.Vector.sub($._MatterMouse.position, pMousePosition)
                // let addedVec = Matter.Vector.add(currDraggingOffset, Matter.Vector.mult(mouseDelta, Matter.Vector.magnitude(currDraggingOffset) / $.BLOCKRADIUS / $._currDragging.parts.length))
                // let rotationAngle = Math.atan2(Matter.Vector.cross(currDraggingOffset, addedVec), Matter.Vector.dot(currDraggingOffset, addedVec))
                // Matter.Body.setAngle($._currDragging, $._currDragging.angle + rotationAngle)
                Matter.Body.applyForce($._currDragging, pMousePosition, Matter.Vector.mult(Matter.Vector.normalise(mouseDelta), Matter.Vector.magnitude(currDraggingOffset) / $._currDragging.parts.length / 256))
                pMousePosition = Matter.Vector.clone($._MatterMouse.position)

                return
            }
            $._MatterBodies.map(function (b) {
                b.parts.map(p => p.isHighlighted = false)
                // highlight group polygon if on hover
                if (Matter.Bounds.contains(b.bounds, $._MatterMouse.position)) {
                    for (let i = 1; i < b.parts.length; i++) {
                        let part = b.parts[i]
                        if ($.pointInsidePolygon(part.vertices, $._MatterMouse.position)) {
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
                $._breakLines.push({ ...$._MatterMouse.position })
                mouseStartOnDrag = false
                $._updateGroupsAfterMouseDrag()
                $._breakLines = []

                // set group non static
                $._MatterBodies.map(function (b) {
                    Matter.Body.setStatic(b, false)
                })
            }

            if ($._currDragging) {
                if ($._targetShadow.targetGroup) {
                    // console.log($._targetShadow.dragGroup, $._targetShadow.targetGroup)
                    Matter.Body.rotate($._currDragging, $._targetShadow.angle)
                    Matter.Body.translate($._currDragging, $._targetShadow.offset)
                    // update group
                    let bks = $._targetShadow.dragGroup.blocks.concat($._targetShadow.targetGroup.blocks)
                    $._MatterBodies = $._MatterBodies.filter(function (b) {
                        if (b === $._targetShadow.targetGroup.poly || b === $._targetShadow.dragGroup.poly) {
                            Matter.World.remove($._MatterEngine.world, b)
                            return false
                        }
                        return true
                    })
                    $._groups.splice($._groups.indexOf($._targetShadow.dragGroup), 1)
                    $._groups.splice($._groups.indexOf($._targetShadow.targetGroup), 1)
                    $._formGroupByLocation(bks)
                    $._targetShadow.targetGroup = null
                }
                else {
                    if ($.debugMode)
                        console.log("drag done")
                    $._groups.map(function (g, i) {
                        $._generateGroupPts(i)
                    })
                }
                $._currDragging = null
                $._targetShadow.opacity = 0
            }
        }

        function onCollisionEndEvent() {
            $._groups.map(function (g, i) {
                $._generateGroupPts(i)
            })
        }

        // dbclick
        $._PIXI.view.addEventListener("dblclick", doubleClicked)
        function doubleClicked() {
            let mouseInsideGroups = false
            $._MatterBodies.map(function (b) {
                if (Matter.Bounds.contains(b.bounds, $._MatterMouse.position)) {
                    mouseInsideGroups = true
                }
            })
            if (!mouseInsideGroups) {
                let block = $.generateBlock($._MatterMouse.position.x, $._MatterMouse.position.y)
                $._blocks.push(block)
                $._formGroupByLocation([block.id])
            }
        }


        /* EXTERNAL EVENTS */
        let eventNames = [
            "beforeFrameUpdated", "afterFrameUpdated",
        ];
        for (let k of eventNames) {
            let intern = "_" + k + "Fn";
            $[intern] = function () { };
            $[intern].isPlaceHolder = true;
            if ($[k]) {
                $[intern] = $[k];
            } else {
                Object.defineProperty($, k, {
                    set: function (fun) { $[intern] = fun; },
                });
            }
        }


        /* PRIVATE FUNCTIONS */

        // Render
        $._drawSpikes = function () {
            $._targetShadow.dragGroup.spikes.map(function (sp) {
                if (sp[2]) {
                    $._PIXIOverlayView.lineStyle(1, 0xFF0000, 0.5)
                }
                else {
                    $._PIXIOverlayView.lineStyle(1, 0x00FF00, 0.25)
                }
                $._PIXIOverlayView.moveTo(sp[0].x, sp[0].y)
                $._PIXIOverlayView.lineTo(sp[1].x, sp[1].y)
            })
        }

        $._drawMatchingEdge = function () {
            let p0 = $._targetShadow.dragGroup.pts[$._targetShadow.dragGroup.intersectings[0]]
            let p1 = $._targetShadow.dragGroup.pts[$._targetShadow.dragGroup.intersectings[1]]
            let p2 = $._targetShadow.targetGroup.pts[$._targetShadow.targetGroup.intersectings[0]]
            let p3 = $._targetShadow.targetGroup.pts[$._targetShadow.targetGroup.intersectings[1]]
            $._PIXIOverlayView.lineStyle(4, 0x00FF00, 0.5)
            $._PIXIOverlayView.moveTo(p0.x, p0.y)
            $._PIXIOverlayView.lineTo(p1.x, p1.y)
            $._PIXIOverlayView.moveTo(p2.x, p2.y)
            $._PIXIOverlayView.lineTo(p3.x, p3.y)
        }

        $._drawTargetShadow = function () {
            if ($._targetShadow.opacity > 0) {
                $._PIXIShadowView.lineStyle(0)
                $._PIXIShadowView.beginFill(0xFFFFFF, $._targetShadow.opacity)
                $._targetShadow.paths.map(function (p) {
                    $._PIXIShadowView.drawPolygon(p)
                })
                $._PIXIShadowView.endFill()
            }
        }


        $._drawBlocksUsingShader = function () {
            for (let i = 0; i < $._blocks.length; i++) {
                const block = $._blocks[i]

                // get block angle
                let midPoint = {
                    x: block.vertices[0].x / 2 + block.vertices[block.vertices.length - 1].x / 2,
                    y: block.vertices[0].y / 2 + block.vertices[block.vertices.length - 1].y / 2
                }
                let angle = Matter.Vector.angle(block.position, midPoint)
                block.mesh.position.set(block.position.x, block.position.y)
                block.mesh.rotation = angle
                block.mesh.shader.uniforms.u_pos = [block.position.x, $._PIXI.screen.height - block.position.y]
                block.mesh.shader.uniforms.u_angle = angle
                block.mesh.shader.uniforms.u_leds = block.colors.reduce((a, c) => a.concat(c), [])
                block.mesh.shader.uniforms.u_highlight = block.isHighlighted

                if ($.debugMode) {
                    // draw angle indicator
                    $._PIXIOverlayView.lineStyle(1, 0xEB4034, 0.25)
                    $._PIXIOverlayView.moveTo(block.position.x, block.position.y)
                    $._PIXIOverlayView.lineTo(block.position.x + (midPoint.x - block.position.x) * 0.88, block.position.y + (midPoint.y - block.position.y) * 0.88)
                }
            }
        }

        $._drawConnections = function () {
            $._PIXIOverlayView.lineStyle(4, 0x00FF00, 0.25)
            for (let i = 0; i < $._groups.length; i++) {
                let connections = $._groups[i].connections
                for (let j = 0; j < connections.length; j++) {
                    let b0 = $._getBlockFromID(connections[j][0])
                    let b1 = $._getBlockFromID(connections[j][1])
                    $._PIXIOverlayView.moveTo(b0.position.x, b0.position.y)
                    $._PIXIOverlayView.lineTo(b1.position.x, b1.position.y)
                }
            }
        }

        $._drawBreakLines = function () {
            if ($._breakLines.length < 2) {
                return
            }

            // draw stroke
            let drawingPath = []
            let prevPoint = $._breakLines[0]
            drawingPath.push(prevPoint.x, prevPoint.y)
            for (let n = 1; n < $._breakLines.length; n++) {
                let currPoint = $._breakLines[n]
                let delta = Matter.Vector.sub(currPoint, prevPoint)
                let midPoint = Matter.Vector.div(Matter.Vector.add(currPoint, prevPoint), 2)
                let step = Matter.Vector.rotate(Matter.Vector.div(delta, 22), 0.75)
                let top = Matter.Vector.add(midPoint, step)
                let bottom = Matter.Vector.sub(midPoint, step)
                drawingPath.push(top.x, top.y)
                drawingPath.unshift(bottom.x, bottom.y)
                prevPoint = currPoint
            }
            $._PIXIOverlayView.lineStyle(3, 0xEE1111, 1)
            $._PIXIOverlayView.beginFill(0xEE1111, 1)
            $._PIXIOverlayView.drawPolygon(drawingPath)
            $._PIXIOverlayView.endFill()
        }

        // deprecated 
        $._drawBlocks = function () {
            for (let i = 0; i < $._blocks.length; i++) {
                let block = $._blocks[i]

                let midPoint = {
                    x: block.vertices[0].x / 2 + block.vertices[block.vertices.length - 1].x / 2,
                    y: block.vertices[0].y / 2 + block.vertices[block.vertices.length - 1].y / 2
                }

                // update round radius
                let vertices = Matter.Vertices.chamfer(block.vertices, $.BLOCKCORNERRADIUS, -1, 2, 14) //default chamfer
                // draw block
                const path = vertices.reduce((a, c) => a.concat([c.x, c.y]), [])
                $._PIXIBlockView.lineStyle(0)
                if (block.isHighlighted) {
                    $._PIXIBlockView.beginFill(0xF08080, 1)
                }
                else {
                    $._PIXIBlockView.beginFill(0xF0F0F0, 1)
                }
                $._PIXIBlockView.drawPolygon(path)
                $._PIXIBlockView.endFill()

                if ($.debugMode) {
                    // draw angle indicator
                    $._PIXIBlockView.lineStyle(1, 0xEB4034, 0.25)
                    $._PIXIBlockView.moveTo(block.position.x, block.position.y)
                    $._PIXIBlockView.lineTo(block.position.x + (midPoint.x - block.position.x) * 0.88, block.position.y + (midPoint.y - block.position.y) * 0.88)
                }
            }
        }

        $._drawGroupAreas = function () {
            for (let i = 0; i < $._groups.length; i++) {
                if (!$._groups[i].innerpts) {
                    return
                }
                let drawingPath = []
                for (let j = 0; j < $._groups[i].innerpts.length; j++) {
                    let ver = $._groups[i].innerpts[j]
                    drawingPath.push(ver.x, ver.y)
                }
                $._PIXIOverlayView.lineStyle(1, 0x0000FF, 0.25)
                $._PIXIOverlayView.beginFill(0xFFFF00, 0.25)
                $._PIXIOverlayView.drawPolygon(drawingPath)
                $._PIXIOverlayView.endFill()
                $._PIXIOverlayView.lineStyle(0)
                for (let j = 0; j < $._groups[i].innerpts.length; j++) {
                    let ver = $._groups[i].innerpts[j]
                    $._PIXIOverlayView.beginFill(0xFF0000, 1)
                    $._PIXIOverlayView.drawCircle(ver.x, ver.y, 3)
                    $._PIXIOverlayView.endFill()
                }
            }
        }

        // Groups
        $._getGroupIndexByBlockID = function (bid) {
            for (let i = 0; i < $._groups.length; i++) {
                if ($._groups[i].blocks.includes(bid)) {
                    return i
                }
            }
            return -1
        }

        $._formGroupByLocation = function (bks) {
            let conns = []
            // clear block connected array
            for (let i = 0; i < bks.length; i++) {
                $._getBlockFromID(bks[i]).connected = [0, 0, 0, 0, 0, 0]
            }

            // loop combination of two
            for (let i = 0; i < bks.length - 1; i++) {
                for (let j = i + 1; j < bks.length; j++) {
                    let b0 = $._getBlockFromID(bks[i])
                    let b1 = $._getBlockFromID(bks[j])
                    // check block distance
                    let d = Matter.Vector.magnitude(Matter.Vector.sub(b0.position, b1.position))
                    if (d < $.BLOCKRADIUS * 3.47) {
                        conns.push([b0.id, b1.id])
                    }
                }
            }
            $._createGroup(bks, conns)
        }

        // create group based on block connections
        $._createGroup = function (bks, conns) {
            // console.log('create group', bks, conns)

            let result = []

            let createdArr = []
            let gid
            conns.map(function (conn) {
                let b0 = $._getBlockFromID(conn[0])
                let b1 = $._getBlockFromID(conn[1])
                let bi0 = $._getGroupIndexByBlockID(b0.id)
                let bi1 = $._getGroupIndexByBlockID(b1.id)
                // console.log(b0, b1, bi0, bi1)
                if (bi0 === -1 && bi1 === -1) { // neither is defined
                    gid = $._groups.length
                    createdArr.push(gid)
                    $._groups.push({
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
                        $._groups[gid].blocks.push(b0.id)
                        bks = bks.filter(function (bid) {
                            return bid !== b0.id
                        })
                    }
                    else {
                        gid = bi0
                        $._groups[gid].blocks.push(b1.id)
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
                    $._groups[gid].blocks = $._groups[gid].blocks.concat($._groups[gidFrom].blocks)
                    $._groups[gid].connections = $._groups[gid].connections.concat($._groups[gidFrom].connections)
                    $._groups.splice(gidFrom, 1)
                    createdArr.splice(createdArr.indexOf(gidFrom), 1)
                }
                // add connections
                $._groups[gid].connections.push([b0.id, b1.id])
                $._createConnection(b0, b1)
            })

            // generate group points for groups
            createdArr.map(function (g) {
                $._generateGroupPts(g)
                // console.log('create a new body', $._groups[g].pts)
                // add group to the world
                let comp = $._generatePolygonFromVertices($._groups[g].pts)
                $._groups[g].poly = comp
                let parts = []
                $._groups[g].blocks.map(function (bid) {
                    let bk = $._getBlockFromID(bid)
                    Matter.Body.setStatic(bk, false)
                    parts.push(bk)
                })
                Matter.Body.setParts(comp, parts, false)

                result.push(comp)
            })

            // create group points for singles
            // console.log('single blocks', bks)
            bks.map(function (bid) {
                let bk = $._getBlockFromID(bid)
                // console.log('bk', bk)
                // add group to the world
                let comp = $._generatePolygonFromVertices(bk.vertices)
                // console.log('comp', comp)
                $._groups.push({
                    poly: comp,
                    blocks: [bid],
                    connections: []
                })
                let gid = $._groups.length - 1
                $._generateGroupPts(gid)
                Matter.Body.setStatic(bk, false)
                Matter.Body.setParts(comp, [bk], false)
                result.push(comp)
            })
            if ($.debugMode) {
                console.log('Groups:', $._groups)
                console.log('World', $._MatterBodies)
            }
            return result
        }

        $._analyzingConnections = function (conns) {
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

        $._divideGroup = function (gid, bconns) {
            if ($.debugMode)
                console.log('divide group ', gid, bconns)

            let filteredConns = $._groups[gid].connections.filter(function (c) {
                let FOUND = false
                bconns.map(function (bc) {
                    if (bc[0] === c[0] && bc[1] === c[1]) {
                        FOUND = true
                    }
                })
                return !FOUND
            })

            // valid break connections
            let sets = $._analyzingConnections(filteredConns)
            if ($.debugMode)
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
            if (filteredConns.length === $._groups[gid].connections.length) {
                return
            }
            if ($.debugMode)
                console.log('filtered connections', filteredConns)

            // clear block connections 
            let bks = $._groups[gid].blocks
            for (let j = 0; j < bks.length; j++) {
                let b = $._getBlockFromID($._groups[gid].blocks[j])
                b.connected = [0, 0, 0, 0, 0, 0]
            }
            // remove group
            $._MatterBodies = $._MatterBodies.filter(function (b) {
                if (b === $._groups[gid].poly) {
                    Matter.World.remove($._MatterEngine.world, b)
                    return false
                }
                return true
            })
            $._groups.splice(gid, 1)

            // create new groups
            let createdGroups = $._createGroup(bks, filteredConns)
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
                $._groups.map(function (g, i) {
                    $._generateGroupPts(i)
                })
            }, 100)
        }

        $._generateGroupPts = function (gid) {
            let group = $._groups[gid]

            let bks = group.blocks

            if (bks.length === 1) {
                let b = $._getBlockFromID(bks[0])
                group.pts = b.vertices
            }
            else {

                // clear pts
                group.pts = []

                // find the bottom right vector as starting point
                // then run CW to get all the points
                let brBlk = $._getBlockFromID(bks[0])
                for (let j = 1; j < bks.length; j++) {
                    let one = $._getBlockFromID(bks[j])
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
                let currPt = brBlk.vertices[(brPt.index + 1) % $.BLOCKSIDES]
                // used to not crash the app
                let counter = 0
                while (currPt !== brPt || counter > group.blocks.length * $.BLOCKSIDES) {
                    // check whether currPt is a connection point
                    let connBlkID = currBlk.connected[currPt.index]
                    group.pts.push(currPt)
                    // console.log('currPt', currBlk.id, currPt.index, connBlkID)
                    if (connBlkID !== 0) {
                        // it's connected, move to next block
                        let preBlkID = currBlk.id
                        currBlk = $._getBlockFromID(connBlkID)
                        for (let c = 0; c < $.BLOCKSIDES; c++) {
                            if (currBlk.connected[c] === preBlkID) {
                                currPt = currBlk.vertices[(c + 2) % $.BLOCKSIDES]
                                break
                            }
                        }
                    }
                    else {
                        // not connected, move to next vertice
                        currPt = currBlk.vertices[(currPt.index + 1) % $.BLOCKSIDES]
                    }
                    counter++
                }
                if (counter > group.blocks.length * $.BLOCKSIDES) {
                    if ($.debugMode)
                        console.warn('Could not find group pts')
                    group.pts = []
                }
            }

            if ($.debugMode) {
                // group.innerpts = hmpoly.createPaddingPolygon(group.pts, $.BLOCKRADIUS)
            }
        }

        // Connections
        $._createConnection = function (b0, b1) {
            // console.log('create connection with', b0.id, b1.id)
            for (let i = 0; i < b0.vertices.length; i++) {
                let v0 = b0.vertices[i]
                let v1 = b0.vertices[(i + 1) % b0.vertices.length]
                let lineIntersect = $.lineSegmentsIntersect(b0.position, b1.position, v0, v1)
                if (lineIntersect) {
                    b0.connected[i] = b1.id
                    break
                }
            }
            for (let j = 0; j < b1.vertices.length; j++) {
                let v0 = b1.vertices[j]
                let v1 = b1.vertices[(j + 1) % b1.vertices.length]
                let lineIntersect = $.lineSegmentsIntersect(b0.position, b1.position, v0, v1)
                if (lineIntersect) {
                    b1.connected[j] = b0.id
                    break
                }
            }
        }

        $._detectSnappingGroup = function () {
            let result

            // generate spikes for current dragging group
            $._targetShadow.dragGroup.spikes = []
            for (let i = 0; i < $._targetShadow.dragGroup.pts.length; i++) {
                let ii = (i + 1) % $._targetShadow.dragGroup.pts.length
                let centerPt = Matter.Vector.mult(Matter.Vector.add($._targetShadow.dragGroup.pts[i], $._targetShadow.dragGroup.pts[ii]), 0.5)
                let farPt = Matter.Vector.add(centerPt, Matter.Vector.mult(Matter.Vector.sub(centerPt, $._targetShadow.dragGroup.pts[ii].body.position), 0.88))
                $._targetShadow.dragGroup.spikes.push([centerPt, farPt, false, $._targetShadow.dragGroup.pts[i], $._targetShadow.dragGroup.pts[ii]])
            }

            // finding intersacting group
            for (let i = 0; i < $._groups.length; i++) {
                let g = $._groups[i]
                if (g === $._targetShadow.dragGroup) {
                    continue
                }
                let FOUND = false
                let minDistance = 1000
                $._targetShadow.dragGroup.spikes.map(function (sp, spi) {
                    let spii = (spi + 1) % $._targetShadow.dragGroup.spikes.length
                    if ($.pointInsidePolygon(g.pts, sp[1])) {
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
                                $._targetShadow.dragGroup.intersectings = [spi, spii]
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

        $._updateTargetShadow = function () {
            if (!$._currDragging) {
                return
            }
            // get dragging group based on currDragging(a Matter Body)
            let dragGroup = $._groups.reduce(function (prev, curr) { return (curr.poly === $._currDragging) ? curr : prev; }, null)
            $._targetShadow.dragGroup = dragGroup

            let targetGroup = $._detectSnappingGroup()
            $._targetShadow.targetGroup = targetGroup
            if (targetGroup) {
                let p0 = Matter.Vector.create(dragGroup.pts[dragGroup.intersectings[0]].x, dragGroup.pts[dragGroup.intersectings[0]].y)
                let p1 = Matter.Vector.create(dragGroup.pts[dragGroup.intersectings[1]].x, dragGroup.pts[dragGroup.intersectings[1]].y)
                let p2 = Matter.Vector.create(targetGroup.pts[targetGroup.intersectings[0]].x, targetGroup.pts[targetGroup.intersectings[0]].y)
                let p3 = Matter.Vector.create(targetGroup.pts[targetGroup.intersectings[1]].x, targetGroup.pts[targetGroup.intersectings[1]].y)
                let l0 = Matter.Vector.normalise(Matter.Vector.sub(p0, p1))
                let l1 = Matter.Vector.normalise(Matter.Vector.sub(p3, p2))
                $._targetShadow.angle = Math.atan2(Matter.Vector.cross(l0, l1), Matter.Vector.dot(l0, l1))
                Matter.Vertices.rotate([p0, p1], $._targetShadow.angle, dragGroup.poly.position)
                let mp0 = Matter.Vector.div(Matter.Vector.add(p0, p1), 2)
                let mp1 = Matter.Vector.div(Matter.Vector.add(p2, p3), 2)
                $._targetShadow.offset = Matter.Vector.sub(mp1, mp0)
                $._targetShadow.paths = dragGroup.poly.parts.filter(function (part, i) {
                    return i !== 0
                }).map(function (p) {
                    let vCopy = p.vertices.map(function (v) {
                        return {
                            x: v.x,
                            y: v.y
                        }
                    })
                    if ($._targetShadow.angle !== 0) {
                        Matter.Vertices.rotate(vCopy, $._targetShadow.angle, dragGroup.poly.position)
                    }
                    Matter.Vertices.translate(vCopy, $._targetShadow.offset)
                    let vertices = Matter.Vertices.chamfer(vCopy, $.BLOCKCORNERRADIUS, -1, 2, 14)
                    const path = vertices.reduce((a, c) => a.concat([c.x, c.y]), [])
                    return path
                })
            }
            if (targetGroup) {
                $._targetShadow.opacity += (0.25 - $._targetShadow.opacity) * 0.2
            }
            else {
                $._targetShadow.opacity += (0 - $._targetShadow.opacity) * 0.2
            }
        }

        $._updateGroupsAfterMouseDrag = function () {
            if ($._breakLines.length < 2) {
                return
            }
            // get first group that got connections broken
            let gid = -1
            let brokenConns = []
            for (let i = 1; i < $._breakLines.length; i++) {
                if (gid < 0) {
                    for (let j = 0; j < $._groups.length; j++) {
                        let INTERSECTED = false
                        for (let m = 0; m < $._groups[j].connections.length; m++) {
                            let b0 = $._getBlockFromID($._groups[j].connections[m][0])
                            let b1 = $._getBlockFromID($._groups[j].connections[m][1])
                            let lineIntersect = $.lineSegmentsIntersect(b0.position, b1.position, $._breakLines[i - 1], $._breakLines[i])
                            if (lineIntersect) {
                                INTERSECTED = true
                                gid = j
                                brokenConns.push([b0.id, b1.id])
                                if ($.debugMode)
                                    console.log('break the connection', b0.id, b1.id)
                            }
                        }
                        if (INTERSECTED) {
                            break
                        }
                    }
                }
                else {
                    for (let m = 0; m < $._groups[gid].connections.length; m++) {
                        let b0 = $._getBlockFromID($._groups[gid].connections[m][0])
                        let b1 = $._getBlockFromID($._groups[gid].connections[m][1])
                        let lineIntersect = $.lineSegmentsIntersect(b0.position, b1.position, $._breakLines[i - 1], $._breakLines[i])
                        if (lineIntersect) {
                            let filteredBC = brokenConns.filter(function (p) {
                                return p[0] === b0.id && p[1] === b1.id
                            })
                            if (filteredBC.length === 0) {
                                brokenConns.push([b0.id, b1.id])
                                if ($.debugMode)
                                    console.log('break the connection', b0.id, b1.id)
                            }
                        }
                    }
                }
            }

            if (gid >= 0 && brokenConns.length > 0) {
                $._divideGroup(gid, brokenConns)
            }
        }

        // Blocks
        $._getBlockFromID = function (id) {
            return $._blocks.reduce(function (prev, curr) { return (curr.id === id) ? curr : prev; }, null)
        }

        $._generatePolygonFromVertices = function (vts) {
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
                friction: $.BLOCKFRICTION,
                frictionAir: $.BLOCKFRICTIONAIR,
            }, false)
            body.pts = pts
            Matter.World.add($._MatterEngine.world, body)
            $._MatterBodies.push(body)
            return body
        }


        /* UTILITIES */

        $.pointInsidePolygon = function (vs, pt) {
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
        $.lineSegmentsIntersect = function (p1, p2, q1, q2) {
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
            const vec3 BG_COLOR = vec3(0.72);
            const float PIXEL_RATIO = 2.0;

            uniform bool u_highlight; //on hover
            uniform float u_radius;
            uniform float u_angle; //angle
            uniform vec2 u_pos; //position
            uniform vec3 u_leds[6]; // leds 

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
                return base < 0.5 ? (2.0 * base * blend) : (1.0 - 2.0 * (1.0 - base) * (1.0 - blend));
            }
            vec3 blendOverlay(vec3 base, vec3 blend) {
                return vec3(blendOverlay(base.r, blend.r), blendOverlay(base.g, blend.g), blendOverlay(base.b, blend.b));
            }
            vec3 blendColors(vec3 base, vec3 blend, float opacity, int mode) {
                // https://github.com/jamieowen/glsl-blend/
                if (mode == 0) {
                    return blend * opacity + base * (1.0 - opacity); // blend nomral
                }
                if (mode == 1) {
                    return blendOverlay(base, blend) * opacity + base * (1.0 - opacity); // blend overlay
                }
                if (mode == 2) {
                    return vec3(max(base.r, blend.r), max(base.g, blend.g), max(base.b, blend.b)) * opacity + base * (1.0 - opacity); // blend lighten
                }
                if (mode == 3) {
                    return vec3(min(base.r, blend.r), min(base.g, blend.g), min(base.b, blend.b)) * opacity + base * (1.0 - opacity); // blend darken
                }
                if (mode == 4) {
                    return base * blend * opacity + base * (1.0 - opacity); // blend multiply
                }
            }

            void main() {
                float BORDER_DIST = u_radius * 3.2;
                vec2 fragCoord = gl_FragCoord.xy / PIXEL_RATIO;

                // set color based on LED lights
                vec3 color = vec3(0);
                bool within_border = false;
                for (int i = 0; i < 6; i++) {
                    float angle = u_angle + PI_3 * float(i);
                    float px = u_pos.x + cos(angle) * u_radius * 2.0;
                    float py = u_pos.y - sin(angle) * u_radius * 2.0;
                    float dc = distance(fragCoord.xy, u_pos.xy); // distance to center
                    float ac = degrees(getAbsoluteAngle(u_pos, fragCoord.xy) + u_angle); // angle to center
                    float d = distance(fragCoord.xy, vec2(px, py));
                    float block_border_pram = abs(30.0 - mod(ac, 60.0)) / 150.0 * u_radius;
                    float a = degrees(getRelativeAngle((fragCoord.xy - u_pos), (vec2(px, py) - u_pos))); // angle to center
                    if (dc < BORDER_DIST - block_border_pram) { //color spread distance, generate the border
                        within_border = true;
                        float o = map(d, 0.0, BORDER_DIST, 1.0, 0.1);
                        // display led light divider
                        if (abs(a) > 30.0) {
                            o *= 0.98;
                        }
                        color = blendColors(color, u_leds[i].rgb, o * o, 2); // blend lights using lighten; use exp instead of linear for opacity
                    }
                }
                if (within_border) {
                    color = blendColors(BG_COLOR, color, 1.0, 1);  // blend color with background using overlay
                    if (u_highlight) {
                        color = blendColors(color, vec3(1.0), 0.66, 1); // add white overlay
                    }
                    gl_FragColor = vec4(color, 1.0);
                }
                else {
                    // set to default color
                    color = BG_COLOR;
                    if (u_highlight) {
                        color = blendColors(color, vec3(1.0), 0.66, 1); // add white overlay
                    }
                }
                gl_FragColor = vec4(color, 1.0);
            }
         `
    }

}
