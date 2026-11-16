import type { TemplateDef, TemplateItem } from './templates';
import { columns, connector, frame, shape, sticky, text } from './builders';

function quadrants(labels: readonly string[], samples: readonly (readonly [string, string])[]): TemplateItem[] {
  return labels.flatMap((label, i) => {
    const x = i % 2 * 600; const y = 160 + Math.floor(i / 2) * 400;
    return [frame(label, x, y, 560, 320), ...samples[i].map((v, j) => sticky(v, (['mint', 'pink', 'yellow', 'sky'] as const)[i], x + 40 + j * 240, y + 40))];
  });
}

export const extraTemplates: readonly TemplateDef[] = [
  {
    id: 'brainstorm', name: 'Brainstorm / mind map', category: 'Brainstorm', description: 'A central question, four connected branches and room for wild ideas.',
    items: [text('How might we make game night easier?', 0, 0, 1200, 'L', true),
      shape('ellipse', 440, 440, 320, 160, 'blue'), text('Better game night', 480, 480, 240, 'M', true),
      ...[{ x: 0, y: 160, title: 'People', note: 'Invite a new friend', tone: 'mint' as const },
        { x: 880, y: 160, title: 'Play', note: 'Vote on three games', tone: 'yellow' as const },
        { x: 0, y: 720, title: 'Time', note: 'Try a 60-minute session', tone: 'pink' as const },
        { x: 880, y: 720, title: 'Rituals', note: 'End with a highlight', tone: 'sky' as const }].flatMap(b => [
        connector('arrow', b.x === 0 ? 440 : 760, b.y < 440 ? 440 : 600, b.x + 120, b.y < 440 ? b.y + 200 : b.y),
        sticky(`${b.title}\n${b.note}`, b.tone, b.x, b.y),
        text('Add one practical idea\nand one wild idea.', b.x, b.y + 240, 280, 'S'),
      ]),
    ],
  },
  {
    id: 'kanban', name: 'Kanban', category: 'Planning', description: 'Three clear columns for a small project, with a work-in-progress limit.',
    items: [text('Small steps, steady progress', 0, 0, 920, 'L', true), text('Pull one task at a time. Doing limit: 2.', 0, 80, 920),
      ...columns(['To do', 'Doing', 'Done'], [['Choose a tiny milestone', '- [ ] Gather references'], ['Build a rough prototype', 'Ask a friend for feedback'], ['Agree on the goal', 'Create the workspace']], ['yellow', 'sky', 'mint'])],
  },
  {
    id: 'weekly-planner', name: 'Weekly planner', category: 'Planning', description: 'Seven days, daily priorities and a short list of weekly goals.',
    items: [text('A week with room to breathe', 0, 0, 2200, 'XL', true),
      text('Goals: ship a small thing · learn something · make time for friends', 0, 80, 2200),
      ...columns(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], [
        ['Plan the week', '- [ ] Pick top priority'], ['Focus block', '- [ ] Share a draft'], ['Midweek check-in', '- [ ] Ask for feedback'],
        ['Polish one detail', '- [ ] Test the changes'], ['Ship and celebrate', '- [ ] Note a lesson'], ['Play something new', '- [ ] Go outside'], ['Rest and reset', '- [ ] Plan one nice thing'],
      ], ['sky', 'mint', 'yellow', 'pink']),
    ],
  },
  {
    id: 'meeting-notes', name: 'Meeting notes', category: 'Planning', description: 'A practical agenda, shared notes, decisions and owned checkboxes.',
    items: [text('Project check-in · 25 minutes', 0, 0, 1160, 'L', true), text('Host: Alex · Scribe: Sam · Outcome: pick the next milestone', 0, 80, 1160),
      ...quadrants(['Agenda', 'Notes', 'Decisions', 'Action items'], [
        ['5 min · Wins and blockers', '20 min · Next milestone'], ['Prototype feels promising', 'Input needs more testing'],
        ['Keep scope to one room', 'Playtest on Friday'], ['- [ ] Book playtest\nAlex · Thursday', '- [ ] Fix input bug\nSam · Friday'],
      ])],
  },
  {
    id: 'decision', name: 'Pros & cons / decision matrix', category: 'Brainstorm', description: 'Compare two options against effort, impact and risk before choosing.',
    items: [text('Decision: build or adapt?', 0, 0, 1160, 'XL', true), text('Score 1–3 (3 is best). Weight impact ×2. Set a decision date.', 0, 80, 1160),
      ...quadrants(['Option A · Build / Pros', 'Option A · Build / Cons', 'Option B · Adapt / Pros', 'Option B · Adapt / Cons'], [
        ['Full creative control', 'Fits our workflow'], ['More maintenance', 'Slower first release'], ['Faster to try', 'Known patterns'], ['Less flexibility', 'Migration risk'],
      ]),
      text('Scorecard                  A     B\nImpact ×2                 3     2\nLow effort ×1             1     3\nLow risk ×1               2     2\nTotal                      9     9\nNext: prototype both for one hour, then decide.', 0, 960, 1160),
    ],
  },
  {
    id: 'swot', name: 'SWOT', category: 'Brainstorm', description: 'Map internal strengths and weaknesses against external opportunities and threats.',
    items: [text('Where do we stand?', 0, 0, 1160, 'XL', true), text('Internal: strengths / weaknesses. External: opportunities / threats.', 0, 80, 1160),
      ...quadrants(['Strengths', 'Weaknesses', 'Opportunities', 'Threats'], [
        ['Small, fast-moving team', 'Distinctive art style'], ['Limited test coverage', 'Only one artist'], ['Friends want to playtest', 'Growing cozy-game audience'], ['Crowded launch window', 'Scope creep'],
      ]), text('- [ ] Use one strength to seize an opportunity\n- [ ] Pick a threat to reduce this week', 0, 960, 1160)],
  },
  {
    id: 'user-journey', name: 'User journey map', category: 'Design', description: 'Follow a new player through actions, thoughts, pain points and opportunities.',
    items: [text('First-time player journey', 0, 0, 1840, 'XL', true),
      text('Persona: a curious friend with 15 minutes to spare', 0, 80, 1840),
      ...['Actions', 'Thoughts', 'Pain points', 'Opportunities'].map((label, i) => text(label, 0, 240 + i * 240, 200, 'M', true)),
      ...['Discover', 'Join', 'First play', 'Return'].flatMap((stage, i) => [frame(stage, 240 + i * 400, 160, 360, 1040),
        ...[
          ['See a friend play', 'Open the invite', 'Try the first room', 'Invite a friend'],
          ['Looks fun!', 'Is setup easy?', 'What do I do?', 'What is new?'],
          ['No clear trailer', 'Too many steps', 'Controls unclear', 'Forgot the link'],
          ['Show a short clip', 'Offer guest access', 'Teach by doing', 'Send a friendly recap'],
        ].map((row, j) => sticky(row[i], (['sky', 'yellow', 'pink', 'mint'] as const)[j], 280 + i * 400, 200 + j * 240)),
      ])],
  },
  {
    id: 'game-one-pager', name: 'Game design one-pager', category: 'Design', description: 'Pitch, audience, mechanics and a connected core loop on one board.',
    items: [text('Lantern Grove · game one-pager', 0, 0, 1520, 'XL', true),
      text('Pitch: a cozy explorer restores a glowing forest, one tiny favor at a time.', 0, 80, 1520),
      frame('Core loop', 0, 200, 1520, 320),
      ...['Explore', 'Collect', 'Craft', 'Restore'].flatMap((label, i) => [shape('ellipse', 40 + i * 360, 280, 240, 120, (['blue', 'green', 'yellow', 'pink'] as const)[i]),
        text(label, 80 + i * 360, 320, 160, 'M', true),
        ...(i < 3 ? [connector('arrow', 280 + i * 360, 340, 400 + i * 360, 340)] : []),
      ]),
      connector('arrow', 1360, 440, 160, 440), text('New paths unlock', 560, 440, 400, 'S'),
      ...['Mechanics', 'Art style', 'Audience'].flatMap((label, i) => [frame(label, i * 520, 600, 480, 560),
        sticky(['Gather light\nTrade with creatures', 'Chunky pixels\nWarm dusk palette', 'Cozy explorers\n15-minute sessions'][i], (['yellow', 'pink', 'sky'] as const)[i], i * 520 + 40, 640),
        text(['- [ ] Prototype one favor\n- [ ] Test the reward', 'References: moss, lanterns,\nhandmade paper', 'No combat pressure.\nReadable on small screens.'][i], i * 520 + 40, 920, 400),
      ])],
  },
  {
    id: 'level-sketch', name: 'Level design sketch', category: 'Design', description: 'A gridded room with a route, hazards, a reward and an editable legend.',
    items: [text('The lantern room · level sketch', 0, 0, 1560, 'XL', true),
      frame('Room grid · 80 units per tile', 0, 160, 960, 640),
      ...Array.from({ length: 11 }, (_, i) => connector('line', 80 + i * 80, 160, 80 + i * 80, 800, 'gray')),
      ...Array.from({ length: 7 }, (_, i) => connector('line', 0, 240 + i * 80, 960, 240 + i * 80, 'gray')),
      shape('rect', 80, 240, 80, 80, 'green', 'solid'), shape('rect', 800, 640, 80, 80, 'blue', 'solid'),
      shape('ellipse', 480, 320, 80, 80, 'yellow', 'solid'), shape('rect', 640, 480, 160, 80, 'red', 'tint'),
      connector('arrow', 200, 280, 480, 280), connector('arrow', 520, 440, 520, 680), connector('arrow', 560, 680, 760, 680),
      frame('Legend & playtest', 1040, 160, 520, 640),
      ...(['green', 'blue', 'yellow', 'red'] as const).flatMap((c, i) => [shape(i === 2 ? 'ellipse' : 'rect', 1080, 200 + i * 80, 40, 40, c, 'solid'), text(['Spawn', 'Exit', 'Reward', 'Hazard'][i], 1160, 200 + i * 80, 320)]),
      text('- [ ] Can players find the exit?\n- [ ] Is the reward worth the detour?\n- [ ] Does the hazard feel fair?', 1080, 560, 440, 'S'),
      text('Flow: learn → choose → risk → reward. Move shapes to try a new route.', 0, 880, 1560)],
  },
  {
    id: 'icebreaker', name: 'Icebreaker', category: 'Fun', description: 'Six playful prompts to get a friend group talking and laughing.',
    items: [text('A tiny warm-up for good company', 0, 0, 1160, 'XL', true), text('Pick a prompt · add your name and answer · take turns sharing. Passing is welcome!', 0, 80, 1160),
      ...['Your most useless superpower?', 'A game world you would live in?', 'Your snack-tier hot take?', 'Name our imaginary band.', 'A tiny win from this week?', 'Your side quest for tomorrow?'].flatMap((q, i) => {
        const x = i % 3 * 400; const y = 200 + Math.floor(i / 3) * 560;
        return [frame(`Round ${i + 1}`, x, y, 360, 480), text(q, x + 40, y + 40, 280, 'M', true),
          sticky(i === 0 ? 'Alex: always finding\nthe cold side of a pillow' : 'Your name:\nYour answer here', (['yellow', 'pink', 'mint', 'sky'] as const)[i % 4], x + 80, y + 200)];
      })],
  },
];
