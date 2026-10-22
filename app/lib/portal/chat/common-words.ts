/**
 * Common English words, embedded (no dependency). Used by the copy gate so that a word of another client's
 * display name ("First", "Gallery", "House", "Grace", "North", "Standard") is not mistaken for that client when
 * it is only part of ordinary wording. It covers everyday vocabulary, days, months, numbers, colors and
 * directions. Matching also tries the plain inflections (plural, -ed, -ing, -er, -ly). Words that are only
 * ever a name (a surname, a coined brand) are deliberately absent so they still match.
 */
const RAW = `
  abandon ability able about above abroad absolute absorb abstract abuse academic accept access accident
  accompany accomplish account accurate achieve acid acme acquire acre across action active actor actual adapt
  added addition address adequate adjust admire admit adopt adult advance advantage adventure advertise advice
  affair affect afford afraid after afternoon again against agency agenda agent agree agreement ahead aid aim
  aircraft airline airport alarm album alcohol alert alive alley alliance allow almost alone along already also
  alter alternative aluminum always amazing amber ambition amend among amount analysis analyst ancient anger
  angle angry animal anniversary announce annoy annual another answer anxiety anybody anymore anyone anything
  anyway apart apartment apology apparent appeal appear appearance appetite apple applicant apply appointment
  appreciate approach appropriate approve april arch architect area arena argue argument arise arm armed army
  around arrange arrest arrival arrive arrow art article artist artistic ash ask asked asleep aspect assault
  assembly assess asset assign assist associate assume assure athlete atmosphere attach attack attempt attend
  attitude attorney attract audience audio august aunt author authority automatic autumn available avenue
  average aviation avoid award aware away baby bachelor back backup bacon badge bag bait bake baker bakery
  balance ball ban band bandage bank banner baptist bar bare bargain barn barrel barrier base baseball basement
  basic basis basket bat bath bathroom battery battle bay beach beam bean bear beard beast beat beautiful beauty
  became because become bedroom been beer before beg began begin behavior behind beige being belief believe bell
  belong below belt bench bend benefit beside best better between beyond bike bill billion bind biology bird
  birth bishop bit bite bitter black blade blame blank blanket blast bleed blend bless blessing blind block blog
  blood blow blue blur board boat body boil bold bomb bond bone bonus book boot booth border bored born borrow
  boss both bother bottle bottom bounce bound bout bow bowl brain brake branch brand brave bread break breakfast
  breast breath breed breeze brick bride bridge brief bright brilliant bring broad broadcast broke broken bronze
  brother brought brown brush bubble bucket budget buffalo bug build builders built bulb bulk bull bullet bump
  bunch burden bureau burn burst bury bus bush business busy butter butterfly button buy buyer cabin cabinet
  cable cafe cage cake calendar call calm came camel camera camp campaign canal cancel cancer candidate candle
  candy cannot cap capable capacity capital captain capture carbon card care career cargo carpet carrot carry
  cart cartoon carve case cash cast castle cat catalog catch category catholic cattle cause cave ceiling
  celebrate celebrity cell cement cemetery census center central century cereal ceremony certain chain chair
  chalk challenge champion chance change channel chaos chapel chapter character charge charity charm chart chase
  chat cheap cheat check cheek cheer cheese chemical chest chicken chief child childhood chip chocolate choice
  choose chop chorus christian church cigarette cinema circle circuit circumstance cite citizen city civic civil
  civilian claim clap clarify class classic classroom clay clean clear clerk click client cliff climate climb
  clinic clip clock close closet cloth clothes clothing cloud club clue cluster coach coal coast coat cocktail
  code coffee coin cold collapse collar colleague collect collection college colonial color column combine come
  comedy comfort comic coming command comment commerce commit committee common communicate community compact
  companion company compare competition complain complete complex component compose compound comprehensive
  compute concept concern concert conclude concrete condition conduct conference confidence confirm conflict
  confuse congregational congress connect consent consequence conservative consider constant construct
  construction consult consume contact contain content contest context continue contract contracting contrast
  contribute control controls convenient convention conversation convert convince cook cool cop copper copy
  coral cord core corn corner corporate corporation correct cost cotton couch cough could council counsel count
  counter country countryside county couple courage course court courtesy cousin cover crack cradle craft crane
  crash crawl crazy cream create creative creature credit crew crime criminal crimson crisis crisp critic crop
  cross crowd crown crucial cruel cruise crush cry crystal cube culture cup cure curious currency current
  curtain curve cushion custom customer cut cyan cycle dad daily dairy dam damage dance danger dare dark dash
  data database date daughter dawn days dead deadline deal dealer dear death debate debt debut decade december
  decent decide deck declare decline decorate decrease dedicate deed deep deer defeat defend defense define
  definite degree delay delegate delicate delight deliver demand democracy demonstrate dense dentist deny
  department departure depend deposit depression depth deputy derive descend describe desert deserve design
  designer desire desk desperate dessert destination destroy detail detect determine develop device devote
  diagram dial diamond diary dictionary diet differ different difficult digital dignity dilemma dim dimension
  dine dinner dip diploma direct director dirt disabled disaster discipline discount discover discuss disease
  dish disk display dispute distance distant distinct distribute district dive diverse diversion diversity
  divide division divorce dock doctor document does dog dollar domestic dominate donate done donkey doom door
  dorm dose dot double doubt down download downtown dozen draft drag dragon drain drama draw drawer dread dream
  dress dressing drift drill drink drive drop drug drum dry duck due dumb dump duration during dust duty dye
  each eager eagle ear early earn earth ease east eastern easy eat echo ecology economic economy edge edit
  edition editor educate education effect effort eight eighteen eighth eighty either elbow elder elderly elect
  election electric electronic elegant element elephant elevator eleven eligible eliminate elite else email
  embrace emerge emergency emotion emphasis empire employ employee employer empty enable enact enclose encounter
  encourage end enemy energetic energy enforce engage engine engineer enjoy enormous enough ensure enter
  entertain enthusiasm entire entrance entry envelope environment episode equal equation equip equipment era
  error escape especially essay essence essential establish estate estimate ethics evaluate even evening event
  ever every evidence evolve exact exactly exam example exceed excellent except exception excess exchange excite
  excuse executive exercise exhaust exhibit exist exit expand expect expense experience experiment expert
  expertise explain explode explore export expose express extend extension extent external extra extreme eye
  fabric face facility fact factor faculty fade fail failure fair fairly faith fall false fame familiar family
  famous fan fancy fantasy far fare farm fascinate fashion fast fat fatal fate father fault favor fear feast
  feather feature february federal fee feed feel fell fellow fellowship felt female fence ferry festival fever
  few fiber fiction field fierce fifteen fifth fifty fight fighter figure file fill film filter final finance
  find finding fine finger fingertip finish fire fireplace firework firm first fish fishing fit fitness five fix
  flag flame flash flat flavor flee flesh flexible flight flip float flood floor flour flow flower fluid flush
  fly foam focus fold folder folk folklore follow fond food foods foolish foot forbid force forecast foreign
  forest forever forget forgive fork form formal former formula fortune forty forum forward fossil foster found
  foundation fountain four fourteen fourth fraction fragile frame frank free freedom freeze freight frequency
  frequent fresh friday fridge friend friendly frighten frog from front frozen fruit frustrate fry fuel fulfill
  full fun function fund funny furniture further fury future gadget gain galaxy galleries gallery gamble game
  gang gap garage garbage garden garlic gas gasoline gate gather gave gender gene general generate generation
  generous genius gentle genuine geography gesture get ghost giant gift gifted ginger giraffe girl give glad
  glance glass global glory glove glow glue goal goat god going gold golf gone good gorgeous gospel gossip got
  govern gown grab grace grade graduate grain grammar grand grandfather grandmother grant grape graph grass
  grateful grave gravity gray great green greet greeting grew grey grid grief grill grip grocer grocery gross
  ground group grow guarantee guard guardian guess guest guide guideline guilty guitar gun guy gym habit habitat
  hair hairdresser half hall hammer hand handful handle handsome hang happen happy hard hardly hardware harm
  harmony harvest hat hate have hazard head headline heal health hear heart heat heaven heavy heel height held
  helicopter hello helmet help helpful hence herb herd here heritage hero hesitate hide high highway hike hill
  himself hint hip hire historic history hit hobby hold hole holiday hollow holy home honest honey honor hook
  hope hopeful horizon horn horror horse hose hospital host hostile hot hotel hour house household housing
  however huge human humble humor hundred hung hungry hunt hunter hurry hurt husband hybrid hydrogen ice icon
  idea ideal identify identity ignore illegal illness illustrate image imagination imagine immediate immigrant
  impact impatient implement imply import important impose impress impression improve incentive inch incident
  incline include income incorporate increase indeed indelible index indicate indigo individual indoor
  industries industry infant infection inflation influence inform initial initiative injury ink inner innocent
  input inquiry insect insert inside insight insist inspect inspire install instance instead institute instruct
  instrument insurance integrate intelligence intend intense interact interest interior internal internet
  interpret interval interview into introduce invent invention invest invitation invite involve iron irrigation
  island isolate issue item itself jack jacket jail jam january jar jaw jazz jealous jeans jelly jet jewel
  jewelry job jog join joint journal journalist journey joy judge judgment juice july jump june jungle junior
  jury just justice justify keen keep kept kettle key keyboard kick kid kidney kill kind king kingdom kiss kit
  kitchen knee knew knife knit knock knot know knowledge label labor lack ladder lady lake lamp land landscape
  lane language laptop large laser last late later latter laugh launch law lawn lawyer lay layer layout lazy
  lead leader leadership leaf league leak lean learn least leather leave lecture left leg legal legend
  legislation leisure lemon lend length lens leopard less lesson let letter level liberal liberty library
  license lid lie life lifetime lift light lighting lightning like likely limb limit limited line linen link
  lion lip liquid list listen literary literature litter little live liver livestock living load loan lobby
  local location lock logic lonely long look loose lord lose loss lost lot lottery loud lounge love lovely lover
  low lower loyal luck luggage lumber lunch lung lutheran luxury lyric machine mad made magazine magenta magic
  magnet maid mail main mainly maintain major make male mall mammal manage manager mansion manual manufacture
  many map maple marble march margin marine mark market marketing maroon marriage marry marsh martial mask mass
  massive master mat match mate material mathematics matter maximize maximum maybe mayor meadow meal mean
  meaning meanwhile measure meat mechanic medal media medical medicine medium meet melon melt member membership
  memorial memory mental mention menu mercy mere merge merit mess message metal method methodist middle might
  mild mile military milk mill million mind mine mineral minimum minister ministries ministry minor minority
  mint minute miracle mirror miss missile mission mistake mix mobile mode model moderate modern modest moisture
  mold molecule moment monday money monitor monkey monster month monthly monument mood moon moral more morning
  mortgage moss most motel mother motion motivate motor motorcycle mount mountain mouse mouth move movie much
  mud mug multi multiple murder muscle museum mushroom music musical must mustard mutual myself mystery myth
  nail naked name narrative narrow nasty nation natural nature navy near nearly neat necessary neck need
  negative neglect negotiate neighbor neighborhood neither nephew nerd nerve nest net network neutral never new
  newly news newspaper next nice niece night nightmare nine nineteen ninety ninth noble nod noise nominate none
  nonprofit noodle noon norm normal north northeast northern northwest nose not note notebook nothing notice
  notion novel november now nowhere nuclear number nurse nut oak oath obey object objective obligation
  observation observe obstacle obtain obvious occasion occupy occur ocean october odd odds off offense offensive
  offer office officer official often oil okay old once one onion online only onto open opening opera operate
  operation opinion opponent opportunity oppose opposite option orange orbit orchard orchestra order ordinary
  organ organic organize origin original ornament orphan other ought ours out outcome outdoor outer outfit
  outlet outline output outside outstanding oval oven over overall overcome overlook owe own owner oxygen oyster
  pace pack package pad page paid pain paint painter painting pair palace pale palm pancake panel panic pants
  paper parade paragraph parallel parcel pardon parent parish park parking parliament part partial participate
  particular partner party pass passage passenger passion passport past pasta pastor pastry patch patent path
  patient patrol pattern pause pavement paw pay payment peace peak pearl peasant pebble pedal peel peer pen
  penalty pencil penny pension people pepper per perceive percent perception perfect perform performance perfume
  perhaps period permanent permission permit person personal personality persuade pet petition phase philosophy
  phone photo photograph phrase physical physician physics piano pick picture pie piece pig pigeon pile pill
  pillow pilot pin pine pink pioneer pipe pitch pizza place plain plaintiff plan plane planet planning plant
  plastic plate platform play player please plenty plot plow plug plumber plus pocket poem poet poetry point
  poison polar pole police policy polish polite political poll pollution pond pony pool poor pop popular
  population porch port portion portrait pose position positive possess possible post postpone pot potato
  pottery poultry pound pour poverty powder power powerful practical practice praise pray prayer preach precious
  precise predict prefer preference pregnant premium preparation prepare prescription presence present preserve
  president press pressure pretend pretty prevent previous prey price pride primary prince principal principle
  print prior priority prison prisoner privacy private privilege prize probably problem procedure proceed
  process produce producer product production profession professional professor profile profit program
  programming programs progress project prominent promise promote prompt pronounce proof proper property
  proposal propose prospect prosperity protect protein protest protocol proud prove provide province psychology
  public publish pudding pull pulse pump punch pupil puppy purchase pure purple purpose pursue push put puzzle
  pyramid qualify quality quantity quarrel quarter queen quest question quick quiet quite quiz quotation quote
  rabbit race racial rack radar radiation radio rage raid rail rain raise rally ran ranch random range rank
  ranking rapid rapidly rare rat rate rather rating ratio rational raw ray razor reach reaction read reader
  reading ready real reality realize rear reason reasonable rebel recall receipt receive receiver recent
  reception recipe recognize recommend reconcile record recover recruit recycle red reduce refer reflect reform
  refrigerator refuge refuse regard regime region register regret regular regulate rehearse reign reject relate
  relation relationship relative relax release relevant reliable relief religion religious rely remain remark
  remarkable remedy remember remind remote remove renew rent repair repeat replace reply report represent
  republic reputation request require rescue research researcher reserve residence resident resign resist
  resolve resort resource respect respond response responsible rest restaurant restore restrict result retail
  retire retreat return reunion reveal revenue reverse review revise revolution reward rhythm ribbon rice rich
  ride ridge rifle right ring rise risk rival river road roast robot rock rocket role roll romance romantic roof
  room root rope rose rotate rotten rough round route row royal rub rubber rude rug ruin rule ruler rumor run
  rural rush rust sacred sacrifice sad saddle safe safety said sail sailor saint salad salary sale salmon salon
  salt same sample sanctuary sand sandwich sat satellite satisfy saturday sauce sausage savage save saving saw
  say scale scan scandal scare scarf scarlet scatter scenario scene scenery schedule scholar scholarship school
  science scissors scope score scout scramble scrap scratch scream screen screw script sculpture sea seal search
  season seasonal seat second secondary secret secretary section sector secure security see seed seek seem seen
  select selection sell senate senator send senior sense sensible sensitive sent sentence separate september
  sequence serial series serious servant serve service services session set settle settlement seven seventeen
  seventh seventy several sew shade shadow shake shall shallow shame shampoo shape share shark sharp shave she
  sheep sheet shelf shell shelter shepherd shield shift shine ship shirt shiver shock shoe shoot shop shore
  short shot should shoulder show shower shrimp shrink shut shy sibling sick side sidewalk sigh sight sign
  signal silence silk silly silver similar simple sin since sing singer single sink sir sister sit site
  situation six sixteen sixth sixty size skate sketch ski skill skin skip skirt skull sky slave sleep sleeve
  slice slide slight slip slogan slope slow small smart smell smile smoke smooth snack snake sneak snow soap
  soccer social society socks sofa soft software soil solar sold soldier solid solo solution solutions solve
  some somebody somehow someone somewhere son song soon sophisticated sorry sort soul sound soup sour source
  south southeast southern southwest souvenir sovereign space spare spark speak special species specific
  spectrum speech speed spell spend spice spider spill spine spirit spiritual spite split spoil spoke sponsor
  spoon sport spot spouse spray spread spring sprinkle spy squad square squeeze stability stable stadium staff
  stage stair stake stamp stand standard standing star stare start state statement station statistic status stay
  steady steak steal steam steel steep stem step stereo stick sticky still stir stock stomach stone stop storage
  store storm story straight strange straw strawberry stream street strength stress stretch strict strike string
  stripe stroke stroll strong structure struggle student studio study stuff stupid style subject subscribe
  substance substitute suburb succeed success successful such suck sudden suffer sufficient sugar suggest suit
  suitable suite sum summary summer summit sun sunday sunrise sunset sunshine super superb superior supermarket
  supper supplement supply support supporter suppose supreme sure surface surgeon surgery surprise surround
  survey survive suspect suspend sustain swallow swamp swap swear sweat sweater sweet swim swing switch sword
  symbol sympathy symptom syrup system table tablet tackle tag tail take tale talent talk tall tan tank tap tape
  target tariff task taste tax taxi tea teach teacher teal team tear teaspoon technology teenager telephone
  television tell temper temperature temple temporary tempt ten tenant tend tender tennis tent tenth term
  terminal terrace terrible terrific territory terror test text textbook texture than thank that the theater
  theft their them theme then theory therapy there thermal these they thick thief thin thing think third
  thirteen thirty this those though thought thousand thread threat three thrill throat throne through throw
  thumb thunder thursday thus ticket tide tidy tie tight tile timber time timing tin tiny tip tire tissue title
  toast today toe together toilet told tolerate tomato tomb tomorrow ton tone tongue tonight too took tool tooth
  top topic tornado tortoise total touch tournament toward towel tower town toy trace track tractor trade
  tradition traditional traffic tragedy trail train trainer transfer transform transit translate transport trap
  trash travel tray treasure treasury treat treatment treaty tree tremendous trend trial tribe tribute trick
  trigger trim trip triumph troop trophy tropical trouble truck true trust truth try tub tube tuesday tulip tune
  tunnel turkey turn tutor twelve twenty twice twin twist two type typical umbrella unable uncertain uncle under
  understand unfair unfortunate uniform union unique unit universe university unknown unless unlike until
  unusual update upgrade upon upper upset urban urge urgent usage use used useful usher usual utility vacation
  vaccine vacuum vague valley valuable value vampire van vanilla vapor variable variation variety various vary
  vascular vast vault vegetable vehicle velvet vendor venture verb verdict vermont verse version versus vertical
  very vessel veteran vice victim victory video view viewer vigorous villa village violate violence violent
  violet violin virtual virtue virus visible vision visit visitor visual vital vitamin vivid vocabulary voice
  volcano volume volunteer vote vow voyage wage wagon waist wait waiter wake walk wall walnut wander want war
  warehouse warm warn warrior was wash waste watch water wave way weak wealth wealthy weapon wear weather weave
  web wedding wednesday weed week weekend weekly weight weird welcome welfare well went were west western wet
  whale what wheat wheel when where whether which while whip whisper whistle white who whole whom whose why
  wicked wide widow width wife wild wilderness wildlife will willing win wind window wine wing winner winter
  wipe wire wisdom wise wish with within without witness wolf woman women wonder wonderful wood wool word work
  worker works workshop world worldwide worm worry worship worth would wound wrap wreck wrestle wrist write
  writer written wrong yacht yard year yellow yes yesterday yet yield yoga you young your youth zebra zero zip
  zone
  something website balloon guild english verified eatery spire septic lifeline crappy mythic anything everything nothing
`;

export const COMMON_WORDS: ReadonlySet<string> = new Set(RAW.split(/\s+/).filter(Boolean));

/** True when the word, or a plain inflection of it, is in the list. */
export function isCommonWord(word: string): boolean {
  const w = word.toLowerCase();
  if (COMMON_WORDS.has(w)) return true;
  const stems: string[] = [];
  if (w.endsWith('ies')) stems.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) stems.push(w.slice(0, -2));
  if (w.endsWith('s')) stems.push(w.slice(0, -1));
  if (w.endsWith('ed')) stems.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) stems.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  if (w.endsWith('er')) stems.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ly')) stems.push(w.slice(0, -2));
  return stems.some((s) => s.length >= 3 && COMMON_WORDS.has(s));
}
