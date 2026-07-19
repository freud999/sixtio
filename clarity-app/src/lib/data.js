// Demo data (in production this comes from the AI-matchmaker backend).
// Photos are CSS gradient placeholders — swap for real user images.

const S = 'repeating-linear-gradient(45deg, rgba(255,255,255,.14) 0 16px, transparent 16px 32px)';

export const DECK = [
  {
    name: 'Аліна', age: 24, city: 'Київ', online: true, compat: 94,
    why: 'близькі цінності — щирість і глибина, схожий темп зближення',
    values: ['Психотерапія', 'Фемінізм', 'Кіно'],
    grad: 'linear-gradient(150deg, oklch(0.72 0.15 285), oklch(0.78 0.13 20)), ' + S,
    photos: [
      'linear-gradient(150deg, oklch(0.72 0.15 285), oklch(0.78 0.13 20)), ' + S,
      'linear-gradient(160deg, oklch(0.7 0.14 300), oklch(0.8 0.12 55)), ' + S,
      'linear-gradient(140deg, oklch(0.66 0.13 265), oklch(0.82 0.1 25)), ' + S,
    ],
    big5: [
      { k: 'Відкритість', v: 92 }, { k: 'Сумлінність', v: 80 }, { k: 'Товариськість', v: 64 },
      { k: 'Доброзичливість', v: 88 }, { k: 'Емоц. стабільність', v: 76 },
    ],
  },
  {
    name: 'Марта', age: 27, city: 'Львів', online: false, compat: 89,
    why: 'спільний темп зближення, схоже почуття гумору та потреба в просторі',
    values: ['Мистецтво', 'Йога', 'Подорожі'],
    grad: 'linear-gradient(150deg, oklch(0.78 0.14 35), oklch(0.74 0.13 320)), ' + S,
    photos: [
      'linear-gradient(150deg, oklch(0.78 0.14 35), oklch(0.74 0.13 320)), ' + S,
      'linear-gradient(160deg, oklch(0.8 0.13 55), oklch(0.72 0.13 300)), ' + S,
      'linear-gradient(140deg, oklch(0.74 0.13 20), oklch(0.78 0.12 340)), ' + S,
    ],
    big5: [
      { k: 'Відкритість', v: 85 }, { k: 'Сумлінність', v: 72 }, { k: 'Товариськість', v: 78 },
      { k: 'Доброзичливість', v: 90 }, { k: 'Емоц. стабільність', v: 70 },
    ],
  },
  {
    name: 'Соломія', age: 23, city: 'Одеса', online: true, compat: 91,
    why: 'схожі погляди на близькість і довіру, обидва цінуєте глибокі розмови',
    values: ['Музика', 'Книги', 'Волонтерство'],
    grad: 'linear-gradient(150deg, oklch(0.76 0.13 200), oklch(0.78 0.13 300)), ' + S,
    photos: [
      'linear-gradient(150deg, oklch(0.76 0.13 200), oklch(0.78 0.13 300)), ' + S,
      'linear-gradient(160deg, oklch(0.74 0.12 220), oklch(0.8 0.12 280)), ' + S,
      'linear-gradient(140deg, oklch(0.78 0.12 190), oklch(0.76 0.13 320)), ' + S,
    ],
    big5: [
      { k: 'Відкритість', v: 90 }, { k: 'Сумлінність', v: 84 }, { k: 'Товариськість', v: 60 },
      { k: 'Доброзичливість', v: 86 }, { k: 'Емоц. стабільність', v: 82 },
    ],
  },
];

// your own Big Five profile — used for the paired comparison in the sheet
export const ME = {
  'Відкритість': 88, 'Сумлінність': 74, 'Товариськість': 58,
  'Доброзичливість': 82, 'Емоц. стабільність': 80,
};

export const CHAT_SRC = [
  { name: 'Аліна', age: 24, last: 'Sixtio пропонує почати з розмови про кіно', time: 'зараз', on: true, unread: true, g: 0 },
  { name: 'Соломія', age: 23, last: 'Ти: Привіт! Бачу, ми обидва любимо книги', time: '2 год', on: false, unread: false, g: 2 },
  { name: 'Марта', age: 27, last: 'Гарного вечора ✨', time: 'вчора', on: false, unread: false, g: 1 },
];

export const PSYCHO = ['енергійно-вибірковий', 'довіри-залежний', 'раціонально щирий', 'емоційно дистантний', 'послідовно закритий'];
export const INTERESTS = ['Футбол', 'Вино', 'Кіно', 'Книги', 'Ігри'];
export const KINKS = ['Світч', 'Експерименти', 'Авантюрність', 'Допитливість', 'Рольові ігри', 'Бондаж'];

export function verdict(v) {
  return v >= 90 ? 'Виняткова сумісність' : v >= 80 ? 'Сильний збіг' : v >= 65 ? 'Гарний збіг' : 'Є основа';
}
