// VR Bot — built-in motivational quotes for Auto status, and the "no repeats" rotation.
// Pure ES module, shared by the bot and the panel. © VR DEVELOPMENTS
// [quote, author]. Short, well-known, attributed. Add your own in the panel ("My own text").
export const QUOTES = [
  ["The only way to do great work is to love what you do.", "Steve Jobs"],
  ["Your time is limited, so don't waste it living someone else's life.", "Steve Jobs"],
  ["Stay hungry. Stay foolish.", "Steve Jobs"],
  ["The journey is the reward.", "Steve Jobs"],
  ["Real artists ship.", "Steve Jobs"],
  ["If you are working on something you really care about, you don't have to be pushed. The vision pulls you.", "Steve Jobs"],
  ["We are what we repeatedly do. Excellence, then, is not an act, but a habit.", "Will Durant"],
  ["The best time to plant a tree was 20 years ago. The second best time is now.", "Chinese proverb"],
  ["A journey of a thousand miles begins with a single step.", "Lao Tzu"],
  ["Knowing is not enough; we must apply. Willing is not enough; we must do.", "Johann Wolfgang von Goethe"],
  ["You miss 100% of the shots you don't take.", "Wayne Gretzky"],
  ["Hard work beats talent when talent doesn't work hard.", "Tim Notke"],
  ["Arise, awake, and stop not till the goal is reached.", "Swami Vivekananda"],
  ["Take up one idea. Make that one idea your life.", "Swami Vivekananda"],
  ["All the powers in the universe are already ours.", "Swami Vivekananda"],
  ["You cannot believe in God until you believe in yourself.", "Swami Vivekananda"],
  ["You have to dream before your dreams can come true.", "A. P. J. Abdul Kalam"],
  ["If you want to shine like a sun, first burn like a sun.", "A. P. J. Abdul Kalam"],
  ["Excellence is a continuous process and not an accident.", "A. P. J. Abdul Kalam"],
  ["Dream is not that which you see while sleeping, it is something that does not let you sleep.", "A. P. J. Abdul Kalam"],
  ["All of us do not have equal talent. But all of us have an equal opportunity to develop our talents.", "A. P. J. Abdul Kalam"],
  ["Learning gives creativity, creativity leads to thinking, thinking provides knowledge, knowledge makes you great.", "A. P. J. Abdul Kalam"],
  ["You have a right to your actions, but never to the fruits of your actions.", "Bhagavad Gita"],
  ["You can't cross the sea merely by standing and staring at the water.", "Rabindranath Tagore"],
  ["Well done is better than well said.", "Benjamin Franklin"],
  ["Lost time is never found again.", "Benjamin Franklin"],
  ["Either write something worth reading or do something worth writing.", "Benjamin Franklin"],
  ["Energy and persistence conquer all things.", "Benjamin Franklin"],
  ["Genius is one percent inspiration and ninety-nine percent perspiration.", "Thomas Edison"],
  ["Life is like riding a bicycle. To keep your balance, you must keep moving.", "Albert Einstein"],
  ["Imagination is more important than knowledge.", "Albert Einstein"],
  ["Try not to become a man of success, but rather try to become a man of value.", "Albert Einstein"],
  ["The important thing is not to stop questioning.", "Albert Einstein"],
  ["The best way to predict the future is to invent it.", "Alan Kay"],
  ["Do what you can, with what you have, where you are.", "Theodore Roosevelt"],
  ["Keep your eyes on the stars, and your feet on the ground.", "Theodore Roosevelt"],
  ["Fall seven times, stand up eight.", "Japanese proverb"],
  ["Vision without action is a daydream. Action without vision is a nightmare.", "Japanese proverb"],
  ["Great things are done by a series of small things brought together.", "Vincent van Gogh"],
  ["I dream my painting and I paint my dream.", "Vincent van Gogh"],
  ["If you hear a voice within you say \"you cannot paint,\" then by all means paint, and that voice will be silenced.", "Vincent van Gogh"],
  ["What we fear doing most is usually what we most need to do.", "Tim Ferriss"],
  ["Focus on being productive instead of busy.", "Tim Ferriss"],
  ["The impediment to action advances action. What stands in the way becomes the way.", "Marcus Aurelius"],
  ["Waste no more time arguing what a good man should be. Be one.", "Marcus Aurelius"],
  ["Very little is needed to make a happy life.", "Marcus Aurelius"],
  ["We suffer more often in imagination than in reality.", "Seneca"],
  ["While we are postponing, life speeds by.", "Seneca"],
  ["It is not that we have a short time to live, but that we waste a lot of it.", "Seneca"],
  ["First say to yourself what you would be; and then do what you have to do.", "Epictetus"],
  ["No man is free who is not master of himself.", "Epictetus"],
  ["Well begun is half done.", "Aristotle"],
  ["Inspiration exists, but it has to find you working.", "Pablo Picasso"],
  ["Amateurs sit and wait for inspiration, the rest of us just get up and go to work.", "Stephen King"],
  ["Do or do not. There is no try.", "Yoda"],
  ["It ain't about how hard you hit. It's about how hard you can get hit and keep moving forward.", "Rocky Balboa"],
  ["Why do we fall? So we can learn to pick ourselves up.", "Alfred, Batman Begins"],
  ["Hope is a good thing, maybe the best of things.", "The Shawshank Redemption"],
  ["Get busy living, or get busy dying.", "The Shawshank Redemption"],
  ["Just keep swimming.", "Dory, Finding Nemo"],
  ["The flower that blooms in adversity is the most rare and beautiful of all.", "Mulan"],
  ["Champions keep playing until they get it right.", "Billie Jean King"],
  ["Pressure is a privilege.", "Billie Jean King"],
  ["I hated every minute of training, but I said, don't quit. Suffer now and live the rest of your life as a champion.", "Muhammad Ali"],
  ["I've failed over and over and over again in my life. And that is why I succeed.", "Michael Jordan"],
  ["Some people want it to happen, some wish it would happen, others make it happen.", "Michael Jordan"],
  ["Talent wins games, but teamwork and intelligence win championships.", "Michael Jordan"],
  ["I can accept failure, everyone fails at something. But I can't accept not trying.", "Michael Jordan"],
  ["The more difficult the victory, the greater the happiness in winning.", "Pelé"],
  ["You don't have to be great to start, but you have to start to be great.", "Zig Ziglar"],
  ["People often say that motivation doesn't last. Well, neither does bathing. That's why we recommend it daily.", "Zig Ziglar"],
  ["There is no elevator to success. You have to take the stairs.", "Zig Ziglar"],
  ["Your attitude, not your aptitude, will determine your altitude.", "Zig Ziglar"],
  ["A goal properly set is halfway reached.", "Zig Ziglar"],
  ["If you can't fly then run, if you can't run then walk, if you can't walk then crawl, but whatever you do, keep moving forward.", "Martin Luther King Jr."],
  ["The time is always right to do what is right.", "Martin Luther King Jr."],
  ["Education is the most powerful weapon which you can use to change the world.", "Nelson Mandela"],
  ["I learned that courage was not the absence of fear, but the triumph over it.", "Nelson Mandela"],
  ["Strength does not come from physical capacity. It comes from an indomitable will.", "Mahatma Gandhi"],
  ["An ounce of practice is worth more than tons of preaching.", "Mahatma Gandhi"],
  ["Perfection is not attainable, but if we chase perfection we can catch excellence.", "Vince Lombardi"],
  ["It's not whether you get knocked down, it's whether you get up.", "Vince Lombardi"],
  ["Winners never quit and quitters never win.", "Vince Lombardi"],
  ["When something is important enough, you do it even if the odds are not in your favor.", "Elon Musk"],
  ["Persistence is very important. You should not give up unless you are forced to give up.", "Elon Musk"],
  ["The first principle is that you must not fool yourself, and you are the easiest person to fool.", "Richard Feynman"],
  ["Nothing in life is to be feared, it is only to be understood.", "Marie Curie"],
  ["Be less curious about people and more curious about ideas.", "Marie Curie"],
  ["Optimism is the faith that leads to achievement.", "Helen Keller"],
  ["Alone we can do so little; together we can do so much.", "Helen Keller"],
  ["Life is either a daring adventure or nothing.", "Helen Keller"],
  ["Keep your face to the sunshine and you cannot see a shadow.", "Helen Keller"],
  ["What you do makes a difference, and you have to decide what kind of difference you want to make.", "Jane Goodall"],
  ["Courage is grace under pressure.", "Ernest Hemingway"],
  ["It's kind of fun to do the impossible.", "Walt Disney"],
  ["Act as if what you do makes a difference. It does.", "William James"],
  ["Small deeds done are better than great deeds planned.", "Peter Marshall"],
  ["The successful warrior is the average man, with laser-like focus.", "Bruce Lee"],
  ["I fear not the man who has practiced 10,000 kicks once, but I fear the man who has practiced one kick 10,000 times.", "Bruce Lee"],
  ["Be water, my friend.", "Bruce Lee"],
  ["Do not pray for an easy life, pray for the strength to endure a difficult one.", "Bruce Lee"],
  ["Mistakes are always forgivable, if one has the courage to admit them.", "Bruce Lee"],
  ["Don't watch the clock; do what it does. Keep going.", "Sam Levenson"],
  ["The only limit to our realization of tomorrow will be our doubts of today.", "Franklin D. Roosevelt"],
  ["Happiness lies in the joy of achievement and the thrill of creative effort.", "Franklin D. Roosevelt"],
  ["Start where you are. Use what you have. Do what you can.", "Arthur Ashe"],
  ["Success is a journey, not a destination. The doing is often more important than the outcome.", "Arthur Ashe"],
  ["Excellence is the gradual result of always striving to do better.", "Pat Riley"],
  ["Hard days are the best because that's when champions are made.", "Gabby Douglas"],
  ["You can't put a limit on anything. The more you dream, the farther you get.", "Michael Phelps"],
  ["Everything negative, pressure, challenges, is all an opportunity for me to rise.", "Kobe Bryant"],
  ["The moment you give up is the moment you let someone else win.", "Kobe Bryant"],
  ["I'd rather regret the risks that didn't work out than the chances I didn't take at all.", "Simone Biles"],
  ["Self-belief and hard work will always earn you success.", "Virat Kohli"],
  ["Chase your dreams, but make sure you don't find shortcuts.", "Sachin Tendulkar"],
  ["People throw stones at you and you convert them into milestones.", "Sachin Tendulkar"],
  ["Enjoy the game and chase your dreams. Dreams do come true.", "Sachin Tendulkar"],
  ["Process is more important than results. If you take care of the process, you will get the results.", "MS Dhoni"],
  ["Don't let what you cannot do interfere with what you can do.", "John Wooden"],
  ["Make each day your masterpiece.", "John Wooden"],
  ["Things work out best for those who make the best of how things work out.", "John Wooden"],
  ["It's not the will to win that matters. Everyone has that. It's the will to prepare to win that matters.", "Bear Bryant"],
  ["Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.", "Antoine de Saint-Exupéry"],
  ["First, solve the problem. Then, write the code.", "John Johnson"],
  ["Talk is cheap. Show me the code.", "Linus Torvalds"],
  ["Make it work, make it right, make it fast.", "Kent Beck"],
  ["Any sufficiently advanced technology is indistinguishable from magic.", "Arthur C. Clarke"],
  ["The best way out is always through.", "Robert Frost"],
  ["In three words I can sum up everything I've learned about life: it goes on.", "Robert Frost"],
  ["Not all those who wander are lost.", "J. R. R. Tolkien"],
  ["All we have to decide is what to do with the time that is given us.", "J. R. R. Tolkien"],
  ["It is our choices that show what we truly are, far more than our abilities.", "J. K. Rowling"],
  ["Rock bottom became the solid foundation on which I rebuilt my life.", "J. K. Rowling"],
  ["Nothing great was ever achieved without enthusiasm.", "Ralph Waldo Emerson"],
  ["If opportunity doesn't knock, build a door.", "Milton Berle"],
  ["Don't be afraid to give up the good to go for the great.", "John D. Rockefeller"],
  ["Go confidently in the direction of your dreams. Live the life you have imagined.", "Henry David Thoreau"],
  ["Dream big and dare to fail.", "Norman Vaughan"],
  ["Everything you've ever wanted is on the other side of fear.", "George Addair"],
  ["Don't wish it were easier, wish you were better.", "Jim Rohn"],
  ["Discipline is the bridge between goals and accomplishment.", "Jim Rohn"],
  ["Motivation is what gets you started. Habit is what keeps you going.", "Jim Rohn"],
  ["Either you run the day or the day runs you.", "Jim Rohn"],
  ["If you really want to do something, you'll find a way. If you don't, you'll find an excuse.", "Jim Rohn"],
  ["Never give in, never, never, never.", "Winston Churchill"],
  ["To improve is to change; to be perfect is to change often.", "Winston Churchill"],
  ["The best preparation for tomorrow is doing your best today.", "H. Jackson Brown Jr."],
  ["Little by little, one travels far.", "Spanish proverb"],
  ["Slow and steady wins the race.", "Aesop"],
  ["Be so good they can't ignore you.", "Steve Martin"],
  ["A ship in harbor is safe, but that is not what ships are built for.", "John A. Shedd"],
  ["If everything seems under control, you're not going fast enough.", "Mario Andretti"],
  ["Efficiency is doing things right; effectiveness is doing the right things.", "Peter Drucker"],
  ["Plans are nothing; planning is everything.", "Dwight D. Eisenhower"],
  ["What is important is seldom urgent and what is urgent is seldom important.", "Dwight D. Eisenhower"],
  ["Inaction breeds doubt and fear. Action breeds confidence and courage.", "Dale Carnegie"],
  ["The most difficult thing is the decision to act, the rest is merely tenacity.", "Amelia Earhart"],
  ["Life shrinks or expands in proportion to one's courage.", "Anaïs Nin"],
  ["Look up at the stars and not down at your feet.", "Stephen Hawking"],
  ["However difficult life may seem, there is always something you can do and succeed at.", "Stephen Hawking"],
  ["Ever tried. Ever failed. No matter. Try again. Fail again. Fail better.", "Samuel Beckett"],
  ["I am not a product of my circumstances. I am a product of my decisions.", "Stephen Covey"],
  ["Begin with the end in mind.", "Stephen Covey"],
  ["The key is not to prioritize what's on your schedule, but to schedule your priorities.", "Stephen Covey"],
  ["You do not rise to the level of your goals. You fall to the level of your systems.", "James Clear"],
  ["Every action you take is a vote for the type of person you wish to become.", "James Clear"],
  ["Habits are the compound interest of self-improvement.", "James Clear"],
  ["Doubt kills more dreams than failure ever will.", "Suzy Kassem"],
  ["A river cuts through rock not because of its power, but because of its persistence.", "Jim Watkins"],
  ["Opportunities don't happen. You create them.", "Chris Grosser"],
  ["If it doesn't challenge you, it doesn't change you.", "Fred DeVito"],
  ["Do one thing every day that scares you.", "Mary Schmich"],
  ["You must do the thing you think you cannot do.", "Eleanor Roosevelt"],
  ["It is not the mountain we conquer, but ourselves.", "Edmund Hillary"],
  ["The struggle you're in today is developing the strength you need for tomorrow.", "Robert Tew"],
  ["Success doesn't come from what you do occasionally. It comes from what you do consistently.", "Marie Forleo"],
  ["Be humble. Be hungry. And always be the hardest worker in the room.", "Dwayne Johnson"],
  ["Success isn't always about greatness. It's about consistency.", "Dwayne Johnson"],
  ["Life is 10% what happens to us and 90% how we react to it.", "Charles R. Swindoll"],
  ["If you want to lift yourself up, lift up someone else.", "Booker T. Washington"],
  ["Without hustle, talent will only carry you so far.", "Gary Vaynerchuk"],
  ["Ideas are easy. Implementation is hard.", "Guy Kawasaki"],
  ["If you're not embarrassed by the first version of your product, you've launched too late.", "Reid Hoffman"],
  ["Make something people want.", "Paul Graham"],
  ["Risk comes from not knowing what you're doing.", "Warren Buffett"],
  ["The best investment you can make is in yourself.", "Warren Buffett"],
  ["Chase the vision, not the money; the money will end up following you.", "Tony Hsieh"],
  ["The only impossible journey is the one you never begin.", "Tony Robbins"],
  ["Setting goals is the first step in turning the invisible into the visible.", "Tony Robbins"],
  ["Victory is always possible for the person who refuses to stop fighting.", "Napoleon Hill"],
  ["Patience, persistence and perspiration make an unbeatable combination for success.", "Napoleon Hill"],
  ["Never let the fear of striking out keep you from playing the game.", "Babe Ruth"],
  ["It's hard to beat a person who never gives up.", "Babe Ruth"],
  ["Gold medals aren't really made of gold. They're made of sweat, determination, and a hard-to-find alloy called guts.", "Dan Gable"],
  ["One person can make a difference, and everyone should try.", "John F. Kennedy"],
  ["Failure is simply the opportunity to begin again, this time more intelligently.", "Henry Ford"],
  ["Nothing is particularly hard if you divide it into small jobs.", "Henry Ford"],
  ["When everything seems to be going against you, remember that the airplane takes off against the wind, not with it.", "Henry Ford"]
];

/** Small deterministic PRNG (mulberry32) so a shuffle can be rebuilt from its seed alone. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The order 0..n-1 shuffled by `seed` (Fisher–Yates). */
export function shuffledOrder(n, seed) {
  const r = rng(seed);
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Next quote index with NO repeats until all n were used, then a fresh shuffle.
 * mem = { n, seed, pos } (kept in the bot's encrypted memory, a few bytes). Mutates and returns the index.
 * If the list length changed, a new cycle starts.
 */
export function nextQuoteIndex(mem, n, random = Math.random) {
  if (!n) return -1;
  if (mem.n !== n || !Number.isInteger(mem.seed) || !(mem.pos >= 0) || mem.pos >= n) {
    const last = mem.n === n && Number.isInteger(mem.seed) ? shuffledOrder(n, mem.seed)[n - 1] : -1;
    mem.n = n; mem.pos = 0;
    mem.seed = Math.floor(random() * 2 ** 31);
    // don't start the new cycle with the quote that ended the old one
    for (let k = 0; k < 20 && n > 1 && shuffledOrder(n, mem.seed)[0] === last; k++) mem.seed = (mem.seed + 1) % 2 ** 31;
  }
  const i = shuffledOrder(n, mem.seed)[mem.pos];
  mem.pos += 1;
  return i;
}

/** "Quote" + author, the way it looks on the status. */
export function formatQuote([text, author]) {
  return `\u201C${text}\u201D\n\n\u2014 ${author}`;
}
