/*
 * The example sketches shown in the Examples menu.
 * note: a line under the group's heading.
 * layout: the Blinks to set up when the example opens. Either the name of a shape in LAYOUTS (js/ui/board.js),
 *   or the exact Blinks: [q, r] or [q, r, rotation] each, on the hex grid (axial coordinates, face 0 up, rotation
 *   0 to 5 clockwise). Lay them out on the table and use "Copy arrangement" in the ⋯ menu to get this text.
 * about, players, time: the game's description from Move38's Blinks app, shown when hovering it.
 */

export const EXAMPLES = [
  {
    group: 'Learn', items: [
      { file: 'learn/01-Hello.ino', title: 'Hello, Blink', blurb: 'setup(), loop() and your first color', layout: 'solo' },
      { file: 'learn/02-Faces.ino', title: 'Six faces', blurb: 'Light each face its own color', layout: 'solo' },
      { file: 'learn/03-Click.ino', title: 'Click to change color', blurb: 'Read the button', layout: 'solo' },
      { file: 'learn/04-Timer.ino', title: 'Spin with a Timer', blurb: 'Animate without delay()', layout: 'solo' },
      { file: 'learn/05-Breathe.ino', title: 'Breathe', blurb: 'Fade with sin8_C() and dim()', layout: 'solo' },
      { file: 'learn/10-Hold.ino', title: 'Press, hold and let go', blurb: 'buttonDown() and long presses', layout: 'solo' },
      { file: 'learn/06-Neighbors.ino', title: 'Who is next to me?', blurb: 'See which faces have neighbors', layout: 'pair' },
      { file: 'learn/07-Messages.ino', title: 'Send a message', blurb: 'Pass numbers between Blinks', layout: 'line' },
      { file: 'learn/08-Spread.ino', title: 'Spread a color', blurb: 'Send news through a whole group', layout: 'flower' },
      { file: 'learn/09-Random.ino', title: 'Random colors', blurb: 'Why randomize() matters', layout: 'trio' },
    ],
  },
  {
    group: 'One-Blink games', note: 'Each plays on a single Blink. Touch more together to play with friends.', items: [
      { file: 'arcade/OrbitLock.ino', title: 'Orbit Lock', blurb: 'Press when the comet hits gold', layout: 'solo' },
      { file: 'arcade/Parrot.ino', title: 'Parrot', blurb: 'Repeat a growing sequence', layout: 'solo' },
      { file: 'arcade/HexBrew.ino', title: 'Hex Brew', blurb: 'Mix the potion', layout: 'solo' },
      { file: 'arcade/HighNoon.ino', title: 'High Noon', blurb: 'Fastest draw wins', layout: 'solo' },
      { file: 'arcade/Ricochet.ino', title: 'Ricochet', blurb: 'Return the ball', layout: 'solo' },
      { file: 'arcade/Spill.ino', title: 'Spill', blurb: 'Flood all six faces', layout: 'solo' },
      { file: 'arcade/Safecracker.ino', title: 'Safecracker', blurb: 'Find the hidden color', layout: 'solo' },
      { file: 'arcade/Fireflies.ino', title: 'Fireflies', blurb: 'Lights Out on a ring of six', layout: 'solo' },
      { file: 'arcade/Honeypot.ino', title: 'Honeypot', blurb: 'Pour without bursting', layout: 'solo' },
      { file: 'arcade/Hexling.ino', title: 'Hexling', blurb: 'Hatch a tiny pet', layout: 'solo' },
    ],
  },
  {
    group: 'Move38 games', items: [
      { file: 'games/Darkball.ino', title: 'Darkball', blurb: 'Beat a speedy, disappearing ball', layout: [[-1, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]],
        about: 'Darkball is a first of its kind game in which players put their timing to the test against a speedy disappearing ball and each other. Darkball rewards accuracy, reaction times, as well as creativity. As the pieces are rearranged, the ball can travel in any direction, and down any path with no limits to the number of players or ways it can be played.', players: '1+', time: '5–15 min' },
      { file: 'games/WHAM.ino', title: 'WHAM!', blurb: 'Defend your garden from pesky moles', layout: 'flower',
        about: 'Set up your garden in any size and shape, then defend it from pesky moles who are up to no good. How long can you keep the increasingly aggressive pests at bay? Show them whose garden it really is.', players: '1+', time: '5–10 min' },
      { file: 'games/Puzzle101.ino', title: 'Puzzle 101', blurb: 'Endless self-generating puzzles', layout: [[0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1]],
        about: 'Challenge yourself or work with friends to solve an endless supply of self-generating puzzles! A terrific way to break from your screen and improve your spatial reasoning skills.', players: '1+', time: '5–10 min' },
      { file: 'games/Astro.ino', title: 'Astro', blurb: 'Mine space ore before your rivals', layout: 'scatter',
        about: 'An asteroid field rich with rare space ore awaits you. Can you collect enough to fill your cargo hold before your competition does? This action-packed space adventure will get your jets going.', players: '2–4', time: '10–15 min' },
      { file: 'games/Berry.ino', title: 'Berry', blurb: 'Make every Blink one color on your turn', layout: [[1, -2], [0, -1], [1, -1], [-1, 0], [0, 0], [-1, 1]],
        about: 'Blue. Red. Yellow. Make all Blinks one color on your turn or be the first to score 10 points and you win. This unique strategy game favors the clever and punishes the greedy.', players: '2', time: '10–15 min' },
      { file: 'games/Fracture.ino', title: 'Fracture', blurb: 'Fracture and rebuild the board', layout: [[-1, -2], [0, -2], [-1, -1], [0, -1], [1, -1], [2, -1], [-1, 0], [0, 0], [1, 0], [-2, 1], [-1, 1], [-2, 2]],
        about: 'Fracture is a new kind of territory control game where players fracture and rebuild the entire board on each turn. From a simple set of rules emerge surprisingly complex strategies.', players: '2–6', time: '15–30 min' },
      { file: 'games/Mortals.ino', title: 'Mortals', blurb: 'Steal time to be the last survivor', layout: [[1, -2], [0, -1], [1, -1], [-2, 0], [-1, 0], [-2, 1]],
        about: 'Be the final survivor in this post-apocalyptic action game. On a dying planet, two teams battle the clock, stealing time from each other. It’s the final countdown… and watch out for the Zombies.', players: '1', time: '5–10 min' },
      { file: 'games/ZenFlow.ino', title: 'Zen Flow', blurb: 'Swirling colors to find your zen', layout: 'flower',
        about: 'Sometimes you need to relax and bliss out at your desk. Be mesmerized by swirling colors and patterns as Blinks share their happiness. Witness emergent behaviors and find your zen.', players: '1+', time: '10–15 min' },
      { file: 'games/SpeedRacer.ino', title: 'Speed Racer', blurb: 'Keep building or hit a dead end', layout: [[2, -2], [2, -1], [-2, 0], [2, 0], [-2, 1], [-2, 2]],
        about: 'Your car is speeding down the road to nowhere. You’ve got to keep building as fast and furiously as you can, or you’re headed for a dead end. How long can you last in this endurance challenge?', players: '1+', time: '10–15 min' },
      { file: 'games/FlicFlop.ino', title: 'Flic Flop', blurb: 'Shuffleboard from the future', layout: 'flower',
        about: 'It’s shuffleboard from the future! Flick your Blinks across the table to score points, and take advantage of your opponent’s mistakes to further your lead. You’ll need accuracy, timing, and finesse to win this kinetic tabletop game.', players: '2–3', time: '10–15 min' },
      { file: 'games/BombBrigade.ino', title: 'Bomb Brigade', blurb: 'One rule: don’t blow up', layout: 'flower',
        about: 'Bomb Brigade is a tense, high-stakes game of chance where players must rely on their quick reflexes and courage to survive. There is really only one rule: don’t blow up.', players: '1–10', time: '5–10 min' },
      { file: 'games/Widgets.ino', title: 'Widgets', blurb: 'Dice, coin flips and spinners', layout: 'flower',
        about: 'The Blink becomes your favorite new game accessory! Light up your game night, whether for Blinks games or not. Need to roll dice, but don’t have the space? Use the dice widget. Settle the score with a coin flip. Spin your own wheel of fortune. You could even use these widgets to invent your own game!', players: '1+', time: '5 min' },
      { file: 'games/Honey.ino', title: 'Honey', blurb: 'Grow a hive to please the queen', layout: 'flower',
        about: 'This idle puzzle game challenges you to create the most optimum hive for your bees. The right combination of flowers, worker bees, and broods will keep the hive buzzing and the queen happy.', players: '1+', time: '15–20 min' },
    ],
  },
  {
    group: 'SDK examples', items: [
      { file: 'sdk/A-BareMinimum.ino', title: 'Bare minimum', blurb: 'An empty sketch', layout: 'solo' },
      { file: 'sdk/B-ButtonPress.ino', title: 'Button press', blurb: '', layout: 'solo' },
      { file: 'sdk/C-ButtonCycleColors.ino', title: 'Button cycle colors', blurb: '', layout: 'solo' },
      { file: 'sdk/D-TimerFlash.ino', title: 'Timer flash', blurb: '', layout: 'solo' },
      { file: 'sdk/E-TimerBlink.ino', title: 'Timer blink', blurb: '', layout: 'solo' },
      { file: 'sdk/F-ColorWheel.ino', title: 'Color wheel', blurb: '', layout: 'solo' },
      { file: 'sdk/G-StartState.ino', title: 'Start state', blurb: 'How was this game loaded?', layout: 'solo' },
      { file: 'sdk/A-ColorByNeighbor.ino', title: 'Color by neighbor', blurb: '', layout: 'flower' },
      { file: 'sdk/B-ColorRamps.ino', title: 'Color ramps', blurb: '', layout: 'solo' },
      { file: 'sdk/E-ButtonGym.ino', title: 'Button gym', blurb: 'Every button event', layout: 'solo' },
      { file: 'sdk/F-SimpleDatagramDemo.ino', title: 'Datagrams', blurb: 'Send packets of bytes', layout: 'pair' },
      { file: 'sdk/D-SerialTest.ino', title: 'Serial', blurb: 'Print to the console', layout: 'solo' },
      { file: 'sdk/H-IRLinkTester.ino', title: 'IR link tester', blurb: '', layout: 'flower' },
    ],
  },
];

export const STARTER = `/*
 * My Blinks sketch
 *
 * setup() runs once when the Blink wakes up.
 * loop() runs over and over.
 */

void setup() {
  randomize();
  setColor(BLUE);
}

void loop() {
  if (buttonSingleClicked()) {
    setColor(makeColorHSB(random(255), 255, 255));
  }
}
`;
