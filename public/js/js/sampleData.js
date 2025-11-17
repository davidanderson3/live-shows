// Sample data used to populate the application for first-time users.

function deepFreeze(obj) {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    Object.getOwnPropertyNames(obj).forEach(prop => {
      deepFreeze(obj[prop]);
    });
  }
  return obj;
}

function futureDate(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split('T')[0];
}

const sampleConferenceDate = futureDate(10);
const sampleMeetingDate = futureDate(11);
const sampleEventStart = futureDate(15);
const sampleEventEnd = futureDate(16);

export const SAMPLE_DECISIONS = [
  {
    id: 'demo-goal',
    type: 'goal',
    text: 'Explore this Application',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: null,
    deadline: '',
    scheduled: '',
    scheduledEnd: ''
  },
  {
    id: 'demo-task-1',
    type: 'task',
    text: 'Explore the demo tasks',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal',
  },
  {
    id: 'demo-task-2',
    type: 'task',
    text: 'Sign up to save your own goals',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal',
  },
  {
    id: 'demo-task-3',
    type: 'task',
    text: 'Try editing and reordering tasks',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal',
  },
  {
    id: 'demo-goal-2',
    type: 'goal',
    text: 'Grow your side project',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: null,
    deadline: '',
    scheduled: '',
    scheduledEnd: ''
  },
  {
    id: 'demo-task-2a',
    type: 'task',
    text: 'Outline your MVP features',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-2',
  },
  {
    id: 'demo-task-2b',
    type: 'task',
    text: 'Launch a landing page',
    completed: true,
    resolution: '',
    dateCompleted: '2025-06-20',
    parentGoalId: 'demo-goal-2',
  },
  {
    id: 'demo-task-2c',
    type: 'task',
    text: 'Get your first users',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-2',
  },
  {
    id: 'demo-goal-3',
    type: 'goal',
    text: 'Completed sample goal',
    completed: true,
    resolution: '',
    dateCompleted: '2025-06-15',
    parentGoalId: null,
    deadline: '',
    scheduled: '',
    scheduledEnd: ''
  },
  {
    id: 'demo-task-3a',
    type: 'task',
    text: 'This is done!',
    completed: true,
    resolution: '',
    dateCompleted: '2025-06-14',
    parentGoalId: 'demo-goal-3',
  },
  {
    id: 'demo-task-3b',
    type: 'task',
    text: 'So is this',
    completed: true,
    resolution: '',
    dateCompleted: '2025-06-15',
    parentGoalId: 'demo-goal-3',
  },
  {
    id: 'demo-goal-4',
    type: 'goal',
    text: 'Future conference talk',
    completed: false,
    resolution: '',
    dateCompleted: '',
    scheduled: sampleConferenceDate,
    parentGoalId: null,
    deadline: '',
    scheduledEnd: ''
  },
  {
    id: 'demo-task-4a',
    type: 'task',
    text: 'Write an outline',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-4',
  },
  {
    id: 'demo-task-4b',
    type: 'task',
    text: 'Create slides',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-4',
  },
  {
    id: 'demo-meeting',
    type: 'task',
    text: 'Meet with a friend',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: null,
    scheduled: sampleMeetingDate,
    scheduledEnd: ''
  },
  {
    id: 'demo-retreat',
    type: 'goal',
    text: 'Weekend retreat',
    completed: false,
    resolution: '',
    dateCompleted: '',
    deadline: '',
    scheduled: '',
    scheduledEnd: ''
  },
  {
    id: 'demo-goal-5a',
    type: 'goal',
    text: 'Book flights',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-5',
    deadline: '',
    scheduled: '',
    scheduledEnd: ''
  },
  {
    id: 'demo-task-5a1',
    type: 'task',
    text: 'Compare airlines',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-5a',
  },
  {
    id: 'demo-task-5a2',
    type: 'task',
    text: 'Purchase tickets',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-5a',
  },
  {
    id: 'demo-goal-5b',
    type: 'goal',
    text: 'Reserve lodging',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-5',
    deadline: '',
    scheduled: '',
    scheduledEnd: ''
  },
  {
    id: 'demo-task-5b1',
    type: 'task',
    text: 'Research hotels',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-5b',
  },
  {
    id: 'demo-task-5b2',
    type: 'task',
    text: 'Book hotel',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-5b',
  },
  {
    id: 'demo-goal-6',
    type: 'goal',
    text: 'Organize community event',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: null,
    deadline: '',
    scheduled: sampleEventStart,
    scheduledEnd: sampleEventEnd
  },
  {
    id: 'demo-goal-6a',
    type: 'goal',
    text: 'Secure speakers',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-6',
    deadline: '',
    scheduled: '',
    scheduledEnd: ''
  },
  {
    id: 'demo-task-6a1',
    type: 'task',
    text: 'Reach out to experts',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-6a',
  },
  {
    id: 'demo-task-6a2',
    type: 'task',
    text: 'Confirm agenda',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-6a',
  },
  {
    id: 'demo-goal-6b',
    type: 'goal',
    text: 'Promote event',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-6',
    deadline: '',
    scheduled: '',
    scheduledEnd: ''
  },
  {
    id: 'demo-task-6b1',
    type: 'task',
    text: 'Design flyer',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-6b',
  },
  {
    id: 'demo-task-6b2',
    type: 'task',
    text: 'Share on social media',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: 'demo-goal-6b',
  },
  {
    id: 'daily-task-1',
    type: 'task',
    text: 'Review tasks each morning',
    completed: false,
    resolution: '',
    dateCompleted: '',
    recurs: 'daily',
    parentGoalId: null,
    timeOfDay: 'morning',
  },
  {
    id: 'daily-task-2',
    type: 'task',
    text: 'Plan your week on Monday',
    completed: false,
    resolution: '',
    dateCompleted: '',
    recurs: 'weekly',
    parentGoalId: null,
  },
  {
    id: 'daily-task-3',
    type: 'task',
    text: 'Share progress on Friday',
    completed: false,
    resolution: '',
    dateCompleted: '',
    recurs: 'weekly',
    parentGoalId: null,
  },
  {
    id: 'daily-task-4',
    type: 'task',
    text: 'Drink a glass of water',
    completed: false,
    resolution: '',
    dateCompleted: '',
    recurs: 'daily',
    parentGoalId: null,
    timeOfDay: 'firstThing',
  },
  {
    id: 'daily-task-5',
    type: 'task',
    text: 'Check calendar for events',
    completed: false,
    resolution: '',
    dateCompleted: '',
    recurs: 'daily',
    parentGoalId: null,
    timeOfDay: 'morning',
  },
  {
    id: 'daily-task-6',
    type: 'task',
    text: 'Stretch for five minutes',
    completed: false,
    resolution: '',
    dateCompleted: '',
    recurs: 'daily',
    parentGoalId: null,
    timeOfDay: 'afternoon',
  },
  {
    id: 'daily-task-7',
    type: 'task',
    text: 'Review yesterday\'s accomplishments',
    completed: false,
    resolution: '',
    dateCompleted: '',
    recurs: 'daily',
    parentGoalId: null,
    timeOfDay: 'afternoon',
  },
  {
    id: 'daily-task-8',
    type: 'task',
    text: 'Take a short walk',
    completed: false,
    resolution: '',
    dateCompleted: '',
    recurs: 'daily',
    parentGoalId: null,
    timeOfDay: 'evening',
  },
  {
    id: 'daily-task-9',
    type: 'task',
    text: 'Plan tomorrow\'s tasks',
    completed: false,
    resolution: '',
    dateCompleted: '',
    recurs: 'daily',
    parentGoalId: null,
    timeOfDay: 'endOfDay',
  },
  {
    id: 'daily-task-10',
    type: 'task',
    text: 'Reflect on progress',
    completed: false,
    resolution: '',
    dateCompleted: '',
    recurs: 'daily',
    parentGoalId: null,
    timeOfDay: 'endOfDay',
  },
  {
    id: 'daily-task-11',
    type: 'task',
    text: 'Review monthly goals',
    completed: false,
    resolution: '',
    dateCompleted: '',
    recurs: 'monthly',
    parentGoalId: null,
  },
  {
    id: 'sample-decision-1',
    type: 'goal',
    text: 'Choose a new laptop',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: null,
    deadline: '',
    scheduled: '',
    scheduledEnd: '',
    outcomes: [
      { text: 'Mac', nextSteps: ['Read reviews'] },
      { text: 'Windows', nextSteps: ['Visit stores'] },
      { text: 'Chromebook', nextSteps: [] }
    ],
    considerations: 'Budget, weight, operating system'
  }
];

export const SAMPLE_LISTS = [
  {
    name: 'Books to Read',
    columns: [
      { name: 'Title', type: 'link' },
      { name: 'Author', type: 'text' }
    ],
    items: [
      { Title: 'https://example.com/book1', Title_label: 'Deep Work', Author: 'Cal Newport' },
      { Title: 'https://example.com/book2', Title_label: 'Atomic Habits', Author: 'James Clear' },
      { Title: 'https://example.com/book3', Title_label: 'The Pragmatic Programmer', Author: 'Andrew Hunt and David Thomas' }
    ]
  },
  {
    name: 'Groceries',
    columns: [
      { name: 'Item', type: 'text' },
      { name: 'Qty', type: 'number' }
    ],
    items: [
      { Item: 'Apples', Qty: '3' },
      { Item: 'Milk', Qty: '1' },
      { Item: 'Eggs', Qty: '12' },
      { Item: 'Bread', Qty: '2' }
    ]
  },
  {
    name: 'Movies to Watch',
    columns: [
      { name: 'Title', type: 'link' },
      { name: 'Year', type: 'number' },
      { name: 'Watched', type: 'checkbox' }
    ],
    items: [
      { Title: 'https://example.com/inception', Title_label: 'Inception', Year: '2010', Watched: false },
      { Title: 'https://example.com/interstellar', Title_label: 'Interstellar', Year: '2014', Watched: true },
      { Title: 'https://example.com/matrix', Title_label: 'The Matrix', Year: '1999', Watched: false }
    ]
  },
  {
    name: 'Travel Packing',
    columns: [
      { name: 'Item', type: 'text' },
      { name: 'Packed', type: 'checkbox' }
    ],
    items: [
      { Item: 'Passport', Packed: true },
      { Item: 'Toothbrush', Packed: false },
      { Item: 'Socks', Packed: false },
      { Item: 'Sunglasses', Packed: false }
    ]
  },
  {
    name: 'Workout Routine',
    columns: [
      { name: 'Exercise', type: 'text' },
      { name: 'Sets', type: 'number' },
      { name: 'Reps', type: 'number' }
    ],
    items: [
      { Exercise: 'Push-ups', Sets: '3', Reps: '15' },
      { Exercise: 'Squats', Sets: '3', Reps: '20' },
      { Exercise: 'Lunges', Sets: '3', Reps: '12' },
      { Exercise: 'Plank', Sets: '3', Reps: '60' },
      { Exercise: 'Burpees', Sets: '3', Reps: '10' },
      { Exercise: 'Mountain Climbers', Sets: '3', Reps: '30' },
      { Exercise: 'Sit-ups', Sets: '3', Reps: '20' },
      { Exercise: 'Jumping Jacks', Sets: '3', Reps: '25' }
    ]
  },
  {
    name: 'Weekly Meal Prep',
    columns: [
      { name: 'Day', type: 'text' },
      { name: 'Meal', type: 'text' }
    ],
    items: [
      { Day: 'Monday', Meal: 'Grilled chicken salad' },
      { Day: 'Tuesday', Meal: 'Veggie stir-fry' },
      { Day: 'Wednesday', Meal: 'Spaghetti bolognese' },
      { Day: 'Thursday', Meal: 'Fish tacos' },
      { Day: 'Friday', Meal: 'Pizza night' },
      { Day: 'Saturday', Meal: 'BBQ burgers' },
      { Day: 'Sunday', Meal: 'Roast beef' },
      { Day: 'Snack', Meal: 'Fruit & yogurt' }
    ]
  },
  {
    name: 'Project Tasks',
    columns: [
      { name: 'Task', type: 'text' },
      { name: 'Due', type: 'date' },
      { name: 'Done', type: 'checkbox' }
    ],
    items: [
      { Task: 'Design mockups', Due: '2024-07-01', Done: false },
      { Task: 'Write documentation', Due: '2024-07-05', Done: false },
      { Task: 'Setup CI pipeline', Due: '2024-07-07', Done: true },
      { Task: 'Implement authentication', Due: '2024-07-10', Done: false },
      { Task: 'Create unit tests', Due: '2024-07-12', Done: false },
      { Task: 'Optimize database', Due: '2024-07-15', Done: false },
      { Task: 'Deploy to staging', Due: '2024-07-18', Done: false },
      { Task: 'Code review', Due: '2024-07-20', Done: false }
    ]
  },
  {
    name: 'Languages to Learn',
    columns: [
      { name: 'Language', type: 'text' },
      { name: 'Level', type: 'text' }
    ],
    items: [
      { Language: 'Spanish', Level: 'Beginner' },
      { Language: 'French', Level: 'Beginner' },
      { Language: 'German', Level: 'Beginner' },
      { Language: 'Japanese', Level: 'Beginner' },
      { Language: 'Mandarin', Level: 'Beginner' },
      { Language: 'Italian', Level: 'Beginner' },
      { Language: 'Russian', Level: 'Beginner' },
      { Language: 'Portuguese', Level: 'Beginner' }
    ]
  },
  {
    name: 'Wishlist',
    columns: [
      { name: 'Item', type: 'text' },
      { name: 'Price', type: 'number' }
    ],
    items: [
      { Item: 'Laptop', Price: '1200' },
      { Item: 'Headphones', Price: '200' },
      { Item: 'Smartwatch', Price: '250' },
      { Item: 'Camera', Price: '800' },
      { Item: 'Electric Scooter', Price: '500' },
      { Item: 'Coffee Maker', Price: '100' },
      { Item: 'Bookshelf', Price: '150' },
      { Item: 'Gaming Chair', Price: '300' }
    ]
  }
];

deepFreeze(SAMPLE_DECISIONS);
deepFreeze(SAMPLE_LISTS);

export const SAMPLE_METRICS = [
  { id: 'mood', label: 'Mood Rating', unit: 'rating', direction: 'higher' },
  { id: 'steps', label: 'Steps Walked', unit: 'count', direction: 'higher' },
  { id: 'sleep', label: 'Hours Slept', unit: 'hours', direction: 'higher' },
  { id: 'focus', label: 'Focus Minutes', unit: 'minutes', direction: 'higher' },
  { id: 'water', label: 'Glasses of Water', unit: 'count', direction: 'higher' },
  { id: 'reading', label: 'Reading Time', unit: 'minutes', direction: 'higher' },
  { id: 'exercise', label: 'Exercise Time', unit: 'minutes', direction: 'higher' },
  { id: 'snacks', label: 'Unhealthy Snacks', unit: 'count', direction: 'lower' },
  { id: 'screen', label: 'Screen Hours', unit: 'hours', direction: 'lower' },
  { id: 'gratitude', label: 'Gratitude Entries', unit: 'count', direction: 'higher' }
];

export const SAMPLE_METRIC_DATA = {
  '2025-06-14': {
    mood: [{ timestamp: 1749888000000, value: 6 }],
    steps: [{ timestamp: 1749888000000, value: 4000 }],
    sleep: [{ timestamp: 1749888000000, value: 7 }],
    focus: [{ timestamp: 1749888000000, value: 90 }],
    water: [{ timestamp: 1749888000000, value: 5 }],
    reading: [{ timestamp: 1749888000000, value: 20 }],
    exercise: [{ timestamp: 1749888000000, value: 30 }],
    snacks: [{ timestamp: 1749888000000, value: 2 }],
    screen: [{ timestamp: 1749888000000, value: 4 }],
    gratitude: [{ timestamp: 1749888000000, value: 1 }]
  },
  '2025-06-15': {
    mood: [{ timestamp: 1749974400000, value: 5 }],
    steps: [{ timestamp: 1749974400000, value: 6000 }],
    sleep: [{ timestamp: 1749974400000, value: 6 }],
    focus: [{ timestamp: 1749974400000, value: 120 }],
    water: [{ timestamp: 1749974400000, value: 6 }],
    reading: [{ timestamp: 1749974400000, value: 15 }],
    exercise: [{ timestamp: 1749974400000, value: 25 }],
    snacks: [{ timestamp: 1749974400000, value: 3 }],
    screen: [{ timestamp: 1749974400000, value: 5 }],
    gratitude: [{ timestamp: 1749974400000, value: 2 }]
  },
  '2025-06-16': {
    mood: [{ timestamp: 1750060800000, value: 7 }],
    steps: [{ timestamp: 1750060800000, value: 5500 }],
    sleep: [{ timestamp: 1750060800000, value: 8 }],
    focus: [{ timestamp: 1750060800000, value: 100 }],
    water: [{ timestamp: 1750060800000, value: 7 }],
    reading: [{ timestamp: 1750060800000, value: 25 }],
    exercise: [{ timestamp: 1750060800000, value: 35 }],
    snacks: [{ timestamp: 1750060800000, value: 1 }],
    screen: [{ timestamp: 1750060800000, value: 3 }],
    gratitude: [{ timestamp: 1750060800000, value: 3 }]
  },
  '2025-06-17': {
    mood: [{ timestamp: 1750147200000, value: 8 }],
    steps: [{ timestamp: 1750147200000, value: 7000 }],
    sleep: [{ timestamp: 1750147200000, value: 7.5 }],
    focus: [{ timestamp: 1750147200000, value: 130 }],
    water: [{ timestamp: 1750147200000, value: 8 }],
    reading: [{ timestamp: 1750147200000, value: 30 }],
    exercise: [{ timestamp: 1750147200000, value: 40 }],
    snacks: [{ timestamp: 1750147200000, value: 0 }],
    screen: [{ timestamp: 1750147200000, value: 4 }],
    gratitude: [{ timestamp: 1750147200000, value: 4 }]
  },
  '2025-06-18': {
    mood: [{ timestamp: 1750233600000, value: 6 }],
    steps: [{ timestamp: 1750233600000, value: 6500 }],
    sleep: [{ timestamp: 1750233600000, value: 7 }],
    focus: [{ timestamp: 1750233600000, value: 110 }],
    water: [{ timestamp: 1750233600000, value: 7 }],
    reading: [{ timestamp: 1750233600000, value: 35 }],
    exercise: [{ timestamp: 1750233600000, value: 30 }],
    snacks: [{ timestamp: 1750233600000, value: 1 }],
    screen: [{ timestamp: 1750233600000, value: 4.5 }],
    gratitude: [{ timestamp: 1750233600000, value: 3 }]
  },
  '2025-06-19': {
    mood: [{ timestamp: 1750320000000, value: 7 }],
    steps: [{ timestamp: 1750320000000, value: 6000 }],
    sleep: [{ timestamp: 1750320000000, value: 6.5 }],
    focus: [{ timestamp: 1750320000000, value: 95 }],
    water: [{ timestamp: 1750320000000, value: 6 }],
    reading: [{ timestamp: 1750320000000, value: 20 }],
    exercise: [{ timestamp: 1750320000000, value: 25 }],
    snacks: [{ timestamp: 1750320000000, value: 2 }],
    screen: [{ timestamp: 1750320000000, value: 5 }],
    gratitude: [{ timestamp: 1750320000000, value: 2 }]
  },
  '2025-06-20': {
    mood: [{ timestamp: 1750406400000, value: 6 }],
    steps: [{ timestamp: 1750406400000, value: 5000 }],
    sleep: [{ timestamp: 1750406400000, value: 7 }],
    focus: [{ timestamp: 1750406400000, value: 105 }],
    water: [{ timestamp: 1750406400000, value: 8 }],
    reading: [{ timestamp: 1750406400000, value: 40 }],
    exercise: [{ timestamp: 1750406400000, value: 20 }],
    snacks: [{ timestamp: 1750406400000, value: 3 }],
    screen: [{ timestamp: 1750406400000, value: 5.5 }],
    gratitude: [{ timestamp: 1750406400000, value: 1 }]
  }
};

export const SAMPLE_HOUR_NOTES = {
  '2024-01-01': { 9: 'Team sync', 13: 'Lunch with Alex' },
  '2024-01-02': { 10: 'Project planning' },
  '2024-01-03': { 11: 'Write documentation' },
  '2024-01-04': { 15: 'Code review' },
  '2024-01-05': { 9: 'Demo prep' },
  '2024-01-06': { 10: 'Hiking' },
  '2024-01-07': { 12: 'Family time' }
};
