// global
var dimensions = {
  width: window.innerWidth,
  height:window.innerHeight
};

// setup matter
Matter.use('matter-attractors');

var Engine = Matter.Engine,
    Render = Matter.Render,
    Runner = Matter.Runner,
    Composites = Matter.Composites,
    Common = Matter.Common,
    MouseConstraint = Matter.MouseConstraint,
    Mouse = Matter.Mouse,
    World = Matter.World,
    Bodies = Matter.Bodies;

// create engine
var engine = Engine.create(),
    world = engine.world;
    world.gravity.y = 0;
    world.gravity.scale = 0

// create renderer
var render = Render.create({
    element: document.body,
    engine: engine,
    options: {
        width: dimensions.width,
        height: dimensions.height,
        showAngleIndicator: true,
    }
});

Render.run(render);

// create runner
var runner = Runner.create();
Runner.run(runner, engine);

// add bodies
var stack = Composites.stack(dimensions.width/2 - 240, dimensions.height/2 - 45, 6, 1, 0, 0, function(x, y) {
    var sides = 6;

    // round bodies corners
    var chamfer = {
        radius: 10
    };
    return Bodies.polygon(x, y, sides, 48, { 
        // density: 0.1,
        friction: 0.8,
        frictionAir: 0.00001,
        // restitution: 0.8,
        plugin: {
            attractors: [
                function(bodyA, bodyB) {
                    var force = {
                        x: (bodyA.position.x - bodyB.position.x) * 1e-6,
                        y: (bodyA.position.y - bodyB.position.y) * 1e-6,
                    };
                    // apply force to both bodies
                    Matter.Body.applyForce(bodyA, bodyA.position, Matter.Vector.neg(force));
                    Matter.Body.applyForce(bodyB, bodyB.position, force);
                }
            ]
        },
        chamfer: chamfer 
    });
});

World.add(world, stack);

// add walls
World.add(world, [
    Bodies.rectangle(dimensions.width/2, -20, dimensions.width, 40, { isStatic: true }), //top
    Bodies.rectangle(dimensions.width/2, dimensions.height + 20, dimensions.width, 40, { isStatic: true }), //bottom
    Bodies.rectangle(dimensions.width + 20, dimensions.height/2, 40, dimensions.height, { isStatic: true }), //right
    Bodies.rectangle(-20, dimensions.height/2, 40, dimensions.height, { isStatic: true }) //left
]);

// add mouse control
var mouse = Mouse.create(render.canvas),
    mouseConstraint = MouseConstraint.create(engine, {
        mouse: mouse,
        constraint: {
            stiffness: 0.2,
            render: {
                visible: false
            }
        }
    });

World.add(world, mouseConstraint);

// keep the mouse in sync with rendering
render.mouse = mouse;

// fit the render viewport to the scene
Render.lookAt(render, {
    min: { x: 0, y: 0 },
    max: { x: dimensions.width, y: dimensions.height }
});