/*
 * The example sketches shown in the Examples menu.
 * layout: which arrangement of Blinks to set up when the example opens.
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
    group: 'Blinks Arcade', items: [
      { file: 'arcade/OrbitLock.ino', title: 'Orbit Lock', blurb: 'Press when the comet hits gold', layout: 'pair' },
      { file: 'arcade/Parrot.ino', title: 'Parrot', blurb: 'Repeat a growing sequence', layout: 'pair' },
      { file: 'arcade/HexBrew.ino', title: 'Hex Brew', blurb: 'Mix the potion', layout: 'trio' },
      { file: 'arcade/HighNoon.ino', title: 'High Noon', blurb: 'Fastest draw wins', layout: 'pair' },
      { file: 'arcade/Ricochet.ino', title: 'Ricochet', blurb: 'Return the ball', layout: 'pair' },
      { file: 'arcade/Spill.ino', title: 'Spill', blurb: 'Flood all six faces', layout: 'solo' },
      { file: 'arcade/Safecracker.ino', title: 'Safecracker', blurb: 'Find the hidden color', layout: 'solo' },
      { file: 'arcade/Fireflies.ino', title: 'Fireflies', blurb: 'Lights Out on a ring of six', layout: 'solo' },
      { file: 'arcade/Honeypot.ino', title: 'Honeypot', blurb: 'Pour without bursting', layout: 'solo' },
      { file: 'arcade/Hexling.ino', title: 'Hexling', blurb: 'Hatch a tiny pet', layout: 'solo' },
    ],
  },
  {
    group: 'Move38 games', items: [
      { file: 'games/Berry.ino', title: 'Berry', blurb: 'Match the pattern', layout: 'flower' },
      { file: 'games/Fracture.ino', title: 'Fracture', blurb: 'Split into same-color teams', layout: 'flower' },
      { file: 'games/Mortals.ino', title: 'Mortals', blurb: 'Battle to stay alive', layout: 'flower' },
      { file: 'games/WHAM.ino', title: 'WHAM!', blurb: 'Whack the lights', layout: 'flower' },
      { file: 'games/Puzzle101.ino', title: 'Puzzle 101', blurb: 'Assemble the puzzle', layout: 'flower' },
      { file: 'games/ZenFlow.ino', title: 'Zen Flow', blurb: 'Calm, flowing colors', layout: 'flower' },
      { file: 'games/SpeedRacer.ino', title: 'Speed Racer', blurb: 'Build the track', layout: 'flower' },
      { file: 'games/FlicFlop.ino', title: 'FlicFlop', blurb: 'Flip and capture', layout: 'flower' },
      { file: 'games/BombBrigade.ino', title: 'Bomb Brigade', blurb: 'Pass the bomb', layout: 'flower' },
      { file: 'games/Astro.ino', title: 'Astro', blurb: 'Mine asteroids', layout: 'flower' },
      { file: 'games/Widgets.ino', title: 'Widgets', blurb: 'Dice, spinner and more', layout: 'flower' },
      { file: 'games/Honey.ino', title: 'Honey', blurb: 'Grow the hive', layout: 'flower' },
      { file: 'games/Darkball.ino', title: 'Darkball', blurb: 'Pinball for a path of Blinks', layout: 'line' },
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
