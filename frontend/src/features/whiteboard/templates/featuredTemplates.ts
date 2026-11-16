import type { TemplateDef, TemplateItem } from './templates';
import { columns, connector, frame, shape, sticky, text } from './builders';

const mood: TemplateItem[] = [
  text('A little world of wonder', 0, 0, 1160, 'XL', true),
  frame('Colour palette', 0, 160, 720, 400),
  ...(['blue', 'green', 'yellow', 'pink'] as const).flatMap((colour, i) => [
    shape('rect', 40 + i * 160, 240, 120, 120, colour, 'solid'),
    text(['#38bdf8', '#22c55e', '#ffd56b', '#ff6b8b'][i], 40 + i * 160, 400, 140, 'S'),
  ]),
  frame('Typography', 760, 160, 760, 400),
  text('Stay curious.', 800, 200, 640, 'XL', true),
  text('Small details, big feelings', 800, 320, 640, 'L'),
  text('Warm stories for playful people.\nKeep the voice simple and welcoming.', 800, 440, 640, 'M'),
  frame('Textures / References', 0, 640, 720, 560),
  ...[40, 400].flatMap(x => [shape('rect', x, 720, 280, 280, 'gray'), text('Drop images here', x + 40, 800, 200, 'S')]),
  text('Look for paper grain and soft light.', 40, 1080, 640),
  frame('Keywords', 760, 640, 760, 560),
  ...['Playful', 'Tactile', 'Bright', 'Cozy', 'Curious', 'Handmade'].map((word, i) => sticky(word, (['yellow', 'mint', 'sky', 'pink'] as const)[i % 4], 800 + i % 3 * 240, 680 + Math.floor(i / 3) * 240)),
  frame('Inspiration notes', 0, 1280, 1520, 320),
  text('Borrow the feeling, not the design.\n- [ ] Collect three references\n- [ ] Pick one texture to test\n- [ ] Check colour contrast', 40, 1320, 880),
  sticky('North star:\nFriendly, never childish.', 'mint', 1200, 1320),
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
      text('Legend: yellow = explore / review · sky = ready · pink = active · mint = shipped', 0, 800, 1560, 'M'),
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
      text('Mood check · add your name to a note', 0, 800, 1240, 'L', true),
      ...['Energized', 'Steady', 'Need a breather', 'Hopeful'].map((v, i) => sticky(v, (['mint', 'sky', 'pink', 'yellow'] as const)[i], i * 320 + 40, 880)),
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
        return [frame(label, x, y, 600, 760), shape('rect', x + 40, y + 40, 520, 160, 'gray'),
          text(`Drop ${label.toLowerCase()} sprite here`, x + 80, y + 80, 440),
          ...['Silhouette\nClear pose? 2/3', 'Palette\nStrong contrast? 2/3', 'Animation\nWeight and timing? 1/3', 'Readability\nWorks at 1×? 2/3'].map((s, j) => sticky(s, (['yellow', 'pink', 'mint', 'sky'] as const)[j], x + 40 + j % 2 * 280, y + 240 + Math.floor(j / 2) * 240)),
          connector('line', x + 40, y + 720, x + 560, y + 720, 'gray')];
      }),
    ],
  },
];
