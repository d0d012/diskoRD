import type { TemplateDef, TemplateItem } from './templates';
import { centred, columns, frame, shape, sticky, text } from './builders';

const mood: TemplateItem[] = [
  text('A little world of wonder', 0, 0, 1160, 'XL', true),
  frame('Colour palette', 0, 160, 720, 300),
  ...(['blue', 'green', 'yellow', 'pink'] as const).flatMap((colour, i) => [
    shape('rect', 40 + i * 170, 200, 130, 130, colour, 'solid'),
    text(`${['Sky', 'Leaf', 'Honey', 'Berry'][i]}\n${['#38bdf8', '#22c55e', '#ffd56b', '#ff6b8b'][i]}`, 40 + i * 170, 350, 130, 'S', false, 'ink', 'center'),
  ]),
  frame('Typography', 760, 160, 760, 300),
  text('Stay curious.', 800, 200, 680, 'XL', true),
  text('Small details, big feelings', 800, 280, 680, 'L'),
  text('Warm stories for playful people.\nKeep the voice simple and welcoming.', 800, 350, 680, 'M'),
  frame('Textures / References', 0, 540, 720, 520),
  ...[40, 400].map(x => shape('rect', x, 580, 280, 320, 'gray')),
  ...[40, 400].map(x => centred('Drop an image here', x + 140, 740, 220, 'S')),
  text('Look for paper grain and soft light.\nAdd a name or link under each image.', 40, 940, 640),
  frame('Keywords', 760, 540, 760, 520),
  ...[['Playful', 'Bouncy and kind'], ['Tactile', 'Paper and felt'], ['Bright', 'Candy colours'], ['Cozy', 'Warm and slow'], ['Curious', 'Always peeking'], ['Handmade', 'Slightly wobbly']]
    .map(([word, note], i) => sticky(`${word}\n${note}`, (['yellow', 'mint', 'sky', 'pink'] as const)[i % 4], 800 + i % 3 * 240, 580 + Math.floor(i / 3) * 240)),
  frame('Inspiration notes', 0, 1140, 1520, 280),
  text('Borrow the feeling, not the design.\n- [ ] Collect three references\n- [ ] Pick one texture to test\n- [ ] Check colour contrast', 40, 1180, 1000),
  sticky('North star:\nFriendly, never childish.', 'mint', 1280, 1180),
];

export const featuredTemplates: readonly TemplateDef[] = [
  {
    id: 'sprint', name: 'Sprint board', category: 'Planning',
    description: 'A five-stage sprint with a goal, example tasks and a colour legend.',
    items: [
      text('Sprint 01 · Make the first minute feel great', 0, 0, 1560, 'L', true),
      text('Goal: a playable loop by Friday. Keep work in progress to two tasks.', 0, 80, 1560),
      ...columns(['Backlog', 'To do', 'In progress', 'Review', 'Done'], [
        ['Explore co-op mode', 'Sketch reward ideas'], ['- [ ] Add tutorial hints', '- [ ] Write a smoke test'],
        ['Tune movement\nOwner: Sam', 'Build the first room\nOwner: Alex'], ['Check controller input', 'Playtest the intro'], ['Set up the repo', 'Fix camera jitter'],
      ], ['yellow', 'sky', 'pink', 'yellow', 'mint']),
      text('Legend: yellow = explore / review · sky = ready · pink = active · mint = shipped', 0, 740, 1560, 'M'),
    ],
  },
  {
    id: 'retro', name: 'Retro', category: 'Planning', description: 'Reflect, share a mood and leave with owned actions.',
    items: [
      text('Look back, move forward', 0, 0, 1240, 'XL', true),
      text('Write silently for 3 min → share → vote → choose one action with an owner.', 0, 80, 1240),
      ...columns(['Went well', 'To improve', 'Ideas', 'Action items'], [
        ['Great pairing sessions', 'Small, safe releases'], ['Flaky tests slowed us', 'Reviews arrived late'],
        ['Try a daily demo', 'Pair on tricky bugs'], ['- [ ] Fix flaky test\nOwner: Sam · Mon', '- [ ] Reserve review time\nOwner: Alex · Tue'],
      ], ['mint', 'pink', 'yellow', 'sky']),
      frame('Mood check · add your name to a note', 0, 760, 1240, 280),
      ...['Energized', 'Steady', 'Need a breather', 'Hopeful'].map((v, i) => sticky(v, (['mint', 'sky', 'pink', 'yellow'] as const)[i], i * 320 + 40, 800)),
    ],
  },
  { id: 'moodboard', name: 'Moodboard', category: 'Design', description: 'Palette, type samples, reference spaces and a wall of mood words.', items: mood },
  {
    id: 'sprite-critique', name: 'Sprite critique wall', category: 'Design', description: 'Six animation reviews with focused prompts and a scoring guide.',
    items: [
      text('Sprite lab · readable at a glance', 0, 0, 1880, 'XL', true),
      text('Score 1 = needs work · 2 = promising · 3 = ready. Be specific; suggest one next step.', 0, 80, 1880),
      ...['Idle', 'Walk', 'Attack', 'Jump', 'Hurt', 'Death'].flatMap((label, i) => {
        const x = i % 3 * 640; const y = 200 + Math.floor(i / 3) * 840;
        const scores = i === 0 ? ['2/3', '2/3', '1/3', '2/3'] : ['_/3', '_/3', '_/3', '_/3'];
        return [frame(label, x, y, 600, 760), shape('rect', x + 40, y + 40, 520, 160, 'gray'),
          centred(`Drop ${label.toLowerCase()} sprite here`, x + 300, y + 120, 440, 'M'),
          ...[['Silhouette', 'Clear pose?'], ['Palette', 'Strong contrast?'], ['Animation', 'Weight and timing?'], ['Readability', 'Works at 1×?']]
            .map(([topic, prompt], j) => sticky(`${topic}\n${prompt} ${scores[j]}`, (['yellow', 'pink', 'mint', 'sky'] as const)[j], x + 40 + j % 2 * 320, y + 240 + Math.floor(j / 2) * 240)),
          text(i === 0 ? 'Next step: hold the last frame longer' : 'Next step:', x + 40, y + 700, 520, 'S')];
      }),
    ],
  },
];
