/**
 * Translations (English / French). `t('path.to.key', { param })` returns the text
 * in the current language; `{name}` placeholders are replaced by the params, and
 * `{ one, other }` entries are chosen with the `count` param.
 * Texts used with tHtml() may contain HTML (they are written here, never user input).
 */

const LANG_KEY = 'mangaBooster.lang';
export const LANGUAGES = ['en', 'fr'];

const DICT = {
  en: {
    app: {
      skip: 'Skip to content',
      loading: 'Shuffling the cards…',
      loadError: "Can't load the game",
      retry: 'Retry',
      sessionExpired: 'Your session has expired, please log in again.',
    },
    nav: { open: 'Open', collection: 'Collection', stats: 'Stats', rules: 'Rules', main: 'Main' },
    titles: { open: 'Open boosters', collection: 'My collection', stats: 'Stats', rules: 'Rules', auth: 'Log in' },
    header: {
      rename: 'Change your name',
      progress: 'Cards collected',
      sound: 'Sound',
      soundOn: 'Sound on',
      soundOff: 'Sound off',
      language: 'Language',
      logout: 'Log out',
      renameTitle: 'Your player name',
      renameLabel: 'Name',
      welcome: 'Welcome, {name}!',
    },
    footer:
      'Card texts from <a href="https://en.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a> (CC BY-SA 4.0) · pictures © their respective owners · fan-made game · <a href="#/rules">rules &amp; API</a>',
    common: { close: 'Close', cancel: 'Cancel', confirm: 'Confirm', save: 'Save', oops: 'Oops', loading: 'Loading…' },
    rarities: { N: 'Normal', R: 'Rare', SR: 'Super Rare', SSR: 'Super Special Rare', UR: 'Ultra Rare' },
    types: {
      action: 'Action',
      adventure: 'Adventure',
      mecha: 'Mecha',
      scifi: 'Sci-Fi',
      fantasy: 'Fantasy',
      romance: 'Romance',
      comedy: 'Comedy',
      slice: 'Slice of Life',
      sports: 'Sports',
      mystery: 'Mystery',
      dark: 'Dark',
      drama: 'Drama',
    },
    eras: { showa: 'Shōwa', heisei: 'Heisei', reiwa: 'Reiwa' },
    sets: {
      'all-stars': { name: 'All-Stars', tagline: 'Every era, every legend' },
      showa: { name: 'Shōwa Classics', tagline: 'The pioneers · before 1989' },
      heisei: { name: 'Heisei Legends', tagline: 'The golden age · 1989–2018' },
      reiwa: { name: 'Reiwa New Wave', tagline: "Today's hits · 2019+" },
    },
    card: {
      label: '{name} — {rarity} card',
      era: '{era} era',
      new: 'NEW!',
      newLabel: 'New card',
      copies: { one: '{count} copy', other: '{count} copies' },
      locked: 'Card number {number}, {rarity}, not collected yet',
    },
    detail: {
      hint: 'Move your pointer over the card ✨',
      copies: 'Copies owned',
      firstPulled: 'First pulled',
      views: 'Wikipedia views (60 days)',
      read: 'Read on Wikipedia ↗',
      picture: 'Picture source',
      previous: 'Previous card',
      next: 'Next card',
      englishOnly: 'No French Wikipedia page for this anime: text in English.',
    },
    open: {
      title: 'Open a booster!',
      sub: '5 anime cards per booster · as many boosters as you want · the 5th card is always <strong>Rare or better</strong>',
      cards: '5 CARDS',
      openOne: 'Open one {set} booster',
      progress: '{have} of {total} cards of this booster collected',
      open: 'Open',
      openTen: 'Open 10 boosters at once',
      collection: 'Collection',
      opened: 'Boosters opened',
      howRarity: 'How does rarity work?',
    },
    stage: {
      label: 'Booster opening',
      tapPack: 'Tap the booster to tear it open!',
      tearLabel: 'Tear the {set} booster open',
      opening: 'Opening…',
      clickCards: 'Click the cards to reveal them',
      reveal: 'Reveal card {n} of {total}',
      revealAll: 'Reveal all',
      clickDetail: 'Click a card to see it in detail',
      newCards: { one: '{count} new card!', other: '{count} new cards!' },
      noNew: 'No new card this time…',
      best: 'Best pull:',
      again: 'Open another',
      openTen: 'Open ×10',
      myCollection: 'My collection',
      revealed: '{name}, {rarity}{isNew}. Show details',
      revealedNew: ', new',
      announce: '{rarity}: {name}{isNew}',
      announceNew: '. New card!',
      bulkOpening: 'Opening {count} boosters…',
      bulkTitle: '{count} boosters · {cards} cards',
      bulkNew: 'NEW',
      bulkAgain: 'Open ×{count} again',
      bulkOne: 'Open one',
      bulkAnnounce: '{cards} cards pulled, {count} new. Best: {best}',
    },
    collection: {
      title: 'My collection',
      sub: 'Missing cards show up as <strong>???</strong> — keep opening boosters to reveal them all.',
      complete: '{percent} complete',
      filterLabel: 'Filter the cards',
      search: 'Search',
      searchPlaceholder: 'Name, author…',
      show: 'Show',
      all: 'All cards',
      owned: 'Owned',
      missing: 'Missing',
      rarity: 'Rarity',
      anyRarity: 'Any rarity',
      type: 'Type',
      anyType: 'Any type',
      era: 'Era',
      anyEra: 'Any era',
      sort: 'Sort by',
      sortNumber: 'Number',
      sortRarity: 'Rarity',
      sortName: 'Name',
      sortYear: 'Year',
      sortCopies: 'Most copies',
      sortRecent: 'Recently pulled',
      count: { one: '{count} card · {owned} owned · {missing} missing', other: '{count} cards · {owned} owned · {missing} missing' },
      emptyTitle: 'Nothing here yet!',
      emptyFiltered: 'No card matches these filters.',
      emptyStart: 'Open your first booster to start your collection.',
      openBooster: 'Open a booster',
      locked: 'Not collected yet — keep opening boosters!',
    },
    stats: {
      loading: 'Loading stats…',
      title: 'Stats',
      playing: 'Playing as <strong>{name}</strong> since {date}.',
      boosters: 'Boosters opened',
      pulled: 'Cards pulled',
      unique: 'Unique cards',
      duplicates: 'Duplicates',
      urPulled: 'UR pulled',
      best: 'Best rarity',
      luck: 'Luck meter',
      luckEmpty: 'Open a few boosters to see how lucky you are.',
      yours: 'your pulls',
      expected: 'expected',
      vs: 'vs',
      leaderboard: 'Leaderboard',
      rank: '#',
      player: 'Player',
      cards: 'Cards',
      boostersCol: 'Boosters',
      you: 'you',
      nobody: 'Nobody has opened a booster yet.',
      history: 'Latest boosters',
      noHistory: 'No booster opened yet.',
      new: 'NEW',
      account: 'Account',
      email: 'E-mail',
      accountText: 'Your cards are saved in your account: log in from any browser to find them.',
      rename: 'Rename',
      renameTitle: 'Rename',
      renameLabel: 'Player name',
      nameSaved: 'Name saved!',
      changePassword: 'Change password',
      passwordTitle: 'Change your password',
      currentPassword: 'Current password',
      newPassword: 'New password',
      passwordSaved: 'Password changed. Your other sessions were logged out.',
      logout: 'Log out',
      reset: 'Reset my collection',
      resetTitle: 'Reset your collection?',
      resetText: 'All your boosters and cards will be deleted. This cannot be undone.',
      resetConfirm: 'Reset',
      resetDone: 'Collection reset. Fresh start!',
    },
    rules: {
      title: 'How it works',
      sub: "{count} anime, one card each — built from their Wikipedia pages. Gotta collect 'em all!",
      step1Title: 'Pick a booster',
      step1: 'All-Stars has every card. The era boosters (Shōwa, Heisei, Reiwa) only contain the anime of that period — handy to hunt a missing card.',
      step2Title: 'Tear it open',
      step2: 'Each booster holds <strong>{size} different cards</strong>. Every card rolls its own rarity, and the last one is always <strong>Rare or better</strong>. Boosters are unlimited!',
      step3Title: 'Complete the set',
      step3: 'Your cards go to your collection. Duplicates stack (×2, ×3…). Can you find all {ur} Ultra Rares?',
      odds: 'Rarities &amp; drop rates',
      colRarity: 'Rarity',
      colCards: 'Cards',
      colSlots: 'Cards 1–{n}',
      colLast: 'Card {n}',
      colAtLeast: 'At least one per booster',
      orBetter: '(or better)',
      guaranteed: 'Guaranteed',
      whereTitle: "Where does a card's rarity come from?",
      where:
        'From Wikipedia! Within each era, the anime whose English Wikipedia page was read the most over the {days} days before {until} get the rarest tiers: the top {ur} are <b>UR</b>, the next {ssr} <b>SSR</b>, and so on. The <b>PWR</b> number printed on a card is that popularity rank (9999 = most read page of its era). Run <code>npm run sync</code> to refresh the data.',
      sets: 'Booster sets',
      setCards: '{count} cards',
      types: 'Card types',
      api: 'REST API',
      apiText: 'Everything the page does goes through a JSON API you can use too (try <a class="link" href="/api/meta" target="_blank">/api/meta</a>). Player routes need to be logged in (session cookie or <code>Authorization: Bearer &lt;token&gt;</code>).',
      credits: 'Credits',
      creditsText:
        'Card texts come from <a class="link" href="https://en.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a> (English and French) and are available under the <a class="link" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a> license. Pictures (manga covers, posters…) belong to their respective owners and are displayed from Wikimedia servers; each card links to its picture\'s source page. This is a fan-made, non-commercial game.',
      routes: {
        health: 'Server status',
        meta: 'Rarities, drop rates, types, eras and booster sets',
        cards: 'All cards · filters: ?rarity=UR&type=action&era=heisei&set=reiwa&q=naruto&sort=rarity',
        card: 'One card (with its French texts)',
        sets: 'Booster sets',
        set: 'One booster set with its cards',
        register: 'Create an account · { "email", "password", "name"? }',
        login: 'Log in · { "email", "password" } → session cookie + token',
        logout: 'Log out',
        me: 'The logged-in player (null when logged out)',
        password: 'Change password · { "currentPassword", "newPassword" }',
        player: 'Your profile and stats',
        rename: 'Rename · { "name" }',
        open: 'Open boosters · { "setId": "all-stars", "count": 1 } (count 1–10)',
        history: 'Your booster history · ?limit=20',
        collection: 'Your cards and completion',
        reset: 'Reset your collection',
        leaderboard: 'Best collectors · ?limit=10',
      },
    },
    auth: {
      kicker: 'ようこそ！',
      title: 'Welcome to Anime Clash Chronicles',
      pitch: 'Open unlimited boosters of anime cards, collect all 151 and climb the leaderboard. Create an account to save your collection.',
      login: 'Log in',
      register: 'Create account',
      name: 'Player name',
      nameHint: 'Optional — you get a random one otherwise',
      email: 'E-mail',
      password: 'Password',
      passwordHint: 'At least 8 characters',
      show: 'Show',
      hide: 'Hide',
      submitLogin: 'Log in',
      submitRegister: 'Create my account',
      toRegister: 'No account yet?',
      toRegisterLink: 'Create one',
      toLogin: 'Already have an account?',
      toLoginLink: 'Log in',
      legacy: 'The cards you already collected in this browser will be moved to your new account.',
      welcomeBack: 'Welcome back, {name}!',
      created: 'Account created! Welcome, {name}!',
      loggedOut: 'See you soon!',
      required: 'Fill in your e-mail and password.',
    },
    errors: {
      invalid_credentials: 'Wrong e-mail or password.',
      email_taken: 'An account already exists with this e-mail.',
      invalid_email: 'Enter a valid e-mail address.',
      weak_password: 'The password must be 8 to 128 characters long.',
      invalid_name: 'The name must be 1 to 24 characters long.',
      too_many_attempts: 'Too many failed attempts. Try again in a few minutes.',
      not_authenticated: 'Please log in.',
      wrong_password: 'The current password is wrong.',
      forbidden: 'This is not your player.',
      network: 'Cannot reach the server. Is it still running?',
    },
  },

  fr: {
    app: {
      skip: 'Aller au contenu',
      loading: 'On mélange les cartes…',
      loadError: 'Impossible de charger le jeu',
      retry: 'Réessayer',
      sessionExpired: 'Ta session a expiré, reconnecte-toi.',
    },
    nav: { open: 'Ouvrir', collection: 'Collection', stats: 'Stats', rules: 'Règles', main: 'Principal' },
    titles: { open: 'Ouvrir des boosters', collection: 'Ma collection', stats: 'Statistiques', rules: 'Règles', auth: 'Connexion' },
    header: {
      rename: 'Changer de nom',
      progress: 'Cartes obtenues',
      sound: 'Son',
      soundOn: 'Son activé',
      soundOff: 'Son coupé',
      language: 'Langue',
      logout: 'Se déconnecter',
      renameTitle: 'Ton nom de joueur',
      renameLabel: 'Nom',
      welcome: 'Bienvenue, {name} !',
    },
    footer:
      'Textes des cartes issus de <a href="https://fr.wikipedia.org" target="_blank" rel="noopener">Wikipédia</a> (CC BY-SA 4.0) · images © leurs propriétaires respectifs · jeu de fan · <a href="#/rules">règles et API</a>',
    common: { close: 'Fermer', cancel: 'Annuler', confirm: 'Confirmer', save: 'Enregistrer', oops: 'Oups', loading: 'Chargement…' },
    rarities: { N: 'Normale', R: 'Rare', SR: 'Super Rare', SSR: 'Super Rare Spéciale', UR: 'Ultra Rare' },
    types: {
      action: 'Action',
      adventure: 'Aventure',
      mecha: 'Mecha',
      scifi: 'Science-fiction',
      fantasy: 'Fantasy',
      romance: 'Romance',
      comedy: 'Comédie',
      slice: 'Tranche de vie',
      sports: 'Sport',
      mystery: 'Mystère',
      dark: 'Sombre',
      drama: 'Drame',
    },
    eras: { showa: 'Shōwa', heisei: 'Heisei', reiwa: 'Reiwa' },
    sets: {
      'all-stars': { name: 'All-Stars', tagline: 'Toutes les époques, toutes les légendes' },
      showa: { name: 'Classiques Shōwa', tagline: 'Les pionniers · avant 1989' },
      heisei: { name: 'Légendes Heisei', tagline: "L'âge d'or · 1989–2018" },
      reiwa: { name: 'Nouvelle vague Reiwa', tagline: "Les hits d'aujourd'hui · 2019+" },
    },
    card: {
      label: '{name} — carte {rarity}',
      era: 'Ère {era}',
      new: 'NOUVEAU !',
      newLabel: 'Nouvelle carte',
      copies: { one: '{count} exemplaire', other: '{count} exemplaires' },
      locked: 'Carte n°{number}, {rarity}, pas encore obtenue',
    },
    detail: {
      hint: 'Passe ta souris sur la carte ✨',
      copies: 'Exemplaires',
      firstPulled: 'Obtenue le',
      views: 'Vues Wikipédia (60 jours)',
      read: 'Lire sur Wikipédia ↗',
      picture: "Source de l'image",
      previous: 'Carte précédente',
      next: 'Carte suivante',
      englishOnly: "Pas de page Wikipédia en français pour cet anime : texte en anglais.",
    },
    open: {
      title: 'Ouvre un booster !',
      sub: '5 cartes d’anime par booster · autant de boosters que tu veux · la 5ᵉ carte est toujours <strong>Rare ou mieux</strong>',
      cards: '5 CARTES',
      openOne: 'Ouvrir un booster {set}',
      progress: '{have} cartes sur {total} de ce booster obtenues',
      open: 'Ouvrir',
      openTen: "Ouvrir 10 boosters d'un coup",
      collection: 'Collection',
      opened: 'Boosters ouverts',
      howRarity: 'Comment marche la rareté ?',
    },
    stage: {
      label: 'Ouverture de booster',
      tapPack: 'Touche le booster pour le déchirer !',
      tearLabel: 'Déchirer le booster {set}',
      opening: 'Ouverture…',
      clickCards: 'Clique sur les cartes pour les retourner',
      reveal: 'Retourner la carte {n} sur {total}',
      revealAll: 'Tout retourner',
      clickDetail: 'Clique sur une carte pour la voir en détail',
      newCards: { one: '{count} nouvelle carte !', other: '{count} nouvelles cartes !' },
      noNew: 'Pas de nouvelle carte cette fois…',
      best: 'Meilleure carte :',
      again: 'Encore un !',
      openTen: 'Ouvrir ×10',
      myCollection: 'Ma collection',
      revealed: '{name}, {rarity}{isNew}. Voir le détail',
      revealedNew: ', nouvelle',
      announce: '{rarity} : {name}{isNew}',
      announceNew: '. Nouvelle carte !',
      bulkOpening: 'Ouverture de {count} boosters…',
      bulkTitle: '{count} boosters · {cards} cartes',
      bulkNew: 'NOUV.',
      bulkAgain: 'Rouvrir ×{count}',
      bulkOne: 'En ouvrir un',
      bulkAnnounce: '{cards} cartes tirées, {count} nouvelles. Meilleure : {best}',
    },
    collection: {
      title: 'Ma collection',
      sub: 'Les cartes manquantes apparaissent en <strong>???</strong> — continue d’ouvrir des boosters pour toutes les découvrir.',
      complete: '{percent} complétée',
      filterLabel: 'Filtrer les cartes',
      search: 'Recherche',
      searchPlaceholder: 'Nom, auteur…',
      show: 'Afficher',
      all: 'Toutes les cartes',
      owned: 'Obtenues',
      missing: 'Manquantes',
      rarity: 'Rareté',
      anyRarity: 'Toutes les raretés',
      type: 'Type',
      anyType: 'Tous les types',
      era: 'Époque',
      anyEra: 'Toutes les époques',
      sort: 'Trier par',
      sortNumber: 'Numéro',
      sortRarity: 'Rareté',
      sortName: 'Nom',
      sortYear: 'Année',
      sortCopies: "Plus d'exemplaires",
      sortRecent: 'Obtenues récemment',
      count: {
        one: '{count} carte · {owned} obtenue(s) · {missing} manquante(s)',
        other: '{count} cartes · {owned} obtenue(s) · {missing} manquante(s)',
      },
      emptyTitle: "Rien ici pour l'instant !",
      emptyFiltered: 'Aucune carte ne correspond à ces filtres.',
      emptyStart: 'Ouvre ton premier booster pour commencer ta collection.',
      openBooster: 'Ouvrir un booster',
      locked: "Pas encore obtenue — continue d'ouvrir des boosters !",
    },
    stats: {
      loading: 'Chargement des stats…',
      title: 'Statistiques',
      playing: 'Tu joues en tant que <strong>{name}</strong> depuis le {date}.',
      boosters: 'Boosters ouverts',
      pulled: 'Cartes tirées',
      unique: 'Cartes uniques',
      duplicates: 'Doublons',
      urPulled: 'UR obtenues',
      best: 'Meilleure rareté',
      luck: 'Jauge de chance',
      luckEmpty: 'Ouvre quelques boosters pour voir si tu as de la chance.',
      yours: 'tes tirages',
      expected: 'attendu',
      vs: 'contre',
      leaderboard: 'Classement',
      rank: '#',
      player: 'Joueur',
      cards: 'Cartes',
      boostersCol: 'Boosters',
      you: 'toi',
      nobody: "Personne n'a encore ouvert de booster.",
      history: 'Derniers boosters',
      noHistory: 'Aucun booster ouvert pour le moment.',
      new: 'NOUV.',
      account: 'Compte',
      email: 'E-mail',
      accountText: "Tes cartes sont enregistrées dans ton compte : connecte-toi depuis n'importe quel navigateur pour les retrouver.",
      rename: 'Renommer',
      renameTitle: 'Renommer',
      renameLabel: 'Nom de joueur',
      nameSaved: 'Nom enregistré !',
      changePassword: 'Changer le mot de passe',
      passwordTitle: 'Changer ton mot de passe',
      currentPassword: 'Mot de passe actuel',
      newPassword: 'Nouveau mot de passe',
      passwordSaved: 'Mot de passe changé. Tes autres sessions ont été déconnectées.',
      logout: 'Se déconnecter',
      reset: 'Réinitialiser ma collection',
      resetTitle: 'Réinitialiser ta collection ?',
      resetText: 'Tous tes boosters et toutes tes cartes seront supprimés. Impossible de revenir en arrière.',
      resetConfirm: 'Réinitialiser',
      resetDone: 'Collection réinitialisée. Nouveau départ !',
    },
    rules: {
      title: 'Comment ça marche',
      sub: '{count} animes, une carte chacun — créées à partir de leurs pages Wikipédia. Attrapez-les tous !',
      step1Title: 'Choisis un booster',
      step1: "All-Stars contient toutes les cartes. Les boosters d'époque (Shōwa, Heisei, Reiwa) ne contiennent que les animes de cette période — pratique pour chasser une carte manquante.",
      step2Title: 'Déchire-le',
      step2: 'Chaque booster contient <strong>{size} cartes différentes</strong>. Chaque carte tire sa propre rareté, et la dernière est toujours <strong>Rare ou mieux</strong>. Les boosters sont illimités !',
      step3Title: 'Complète la collection',
      step3: 'Tes cartes vont dans ta collection. Les doublons s’empilent (×2, ×3…). Sauras-tu trouver les {ur} Ultra Rares ?',
      odds: 'Raretés et taux de tirage',
      colRarity: 'Rareté',
      colCards: 'Cartes',
      colSlots: 'Cartes 1 à {n}',
      colLast: 'Carte {n}',
      colAtLeast: 'Au moins une par booster',
      orBetter: '(ou mieux)',
      guaranteed: 'Garantie',
      whereTitle: "D'où vient la rareté d'une carte ?",
      where:
        "De Wikipédia ! Dans chaque époque, les animes dont la page Wikipédia anglaise a été la plus lue pendant les {days} jours avant le {until} obtiennent les raretés les plus hautes : les {ur} premiers sont <b>UR</b>, les {ssr} suivants <b>SSR</b>, et ainsi de suite. Le nombre <b>PWR</b> imprimé sur une carte est ce rang de popularité (9999 = page la plus lue de son époque). Lance <code>npm run sync</code> pour mettre les données à jour.",
      sets: 'Les boosters',
      setCards: '{count} cartes',
      types: 'Types de cartes',
      api: 'API REST',
      apiText: "Tout ce que fait la page passe par une API JSON que tu peux utiliser toi aussi (essaie <a class=\"link\" href=\"/api/meta\" target=\"_blank\">/api/meta</a>). Les routes du joueur demandent d'être connecté (cookie de session ou <code>Authorization: Bearer &lt;token&gt;</code>).",
      credits: 'Crédits',
      creditsText:
        'Les textes des cartes viennent de <a class="link" href="https://fr.wikipedia.org" target="_blank" rel="noopener">Wikipédia</a> (en français et en anglais) et sont sous licence <a class="link" href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr" target="_blank" rel="noopener">CC BY-SA 4.0</a>. Les images (couvertures de mangas, affiches…) appartiennent à leurs propriétaires respectifs et sont affichées depuis les serveurs de Wikimedia ; chaque carte renvoie vers la page source de son image. Ce jeu est un projet de fan, non commercial.',
      routes: {
        health: 'État du serveur',
        meta: 'Raretés, taux de tirage, types, époques et boosters',
        cards: 'Toutes les cartes · filtres : ?rarity=UR&type=action&era=heisei&set=reiwa&q=naruto&sort=rarity',
        card: 'Une carte (avec ses textes en français)',
        sets: 'Les boosters',
        set: 'Un booster et ses cartes',
        register: 'Créer un compte · { "email", "password", "name"? }',
        login: 'Se connecter · { "email", "password" } → cookie de session + jeton',
        logout: 'Se déconnecter',
        me: 'Le joueur connecté (null si déconnecté)',
        password: 'Changer de mot de passe · { "currentPassword", "newPassword" }',
        player: 'Ton profil et tes stats',
        rename: 'Renommer · { "name" }',
        open: 'Ouvrir des boosters · { "setId": "all-stars", "count": 1 } (count de 1 à 10)',
        history: 'Historique de tes boosters · ?limit=20',
        collection: 'Tes cartes et ta progression',
        reset: 'Réinitialiser ta collection',
        leaderboard: 'Meilleurs collectionneurs · ?limit=10',
      },
    },
    auth: {
      kicker: 'ようこそ！',
      title: 'Bienvenue dans Anime Clash Chronicles',
      pitch: 'Ouvre des boosters de cartes d’anime à l’infini, collectionne les 151 cartes et grimpe au classement. Crée un compte pour sauvegarder ta collection.',
      login: 'Connexion',
      register: 'Créer un compte',
      name: 'Nom de joueur',
      nameHint: 'Facultatif — sinon on t’en choisit un au hasard',
      email: 'E-mail',
      password: 'Mot de passe',
      passwordHint: 'Au moins 8 caractères',
      show: 'Afficher',
      hide: 'Masquer',
      submitLogin: 'Se connecter',
      submitRegister: 'Créer mon compte',
      toRegister: 'Pas encore de compte ?',
      toRegisterLink: 'Crée-en un',
      toLogin: 'Déjà un compte ?',
      toLoginLink: 'Connecte-toi',
      legacy: 'Les cartes déjà collectées dans ce navigateur seront transférées sur ton nouveau compte.',
      welcomeBack: 'Content de te revoir, {name} !',
      created: 'Compte créé ! Bienvenue, {name} !',
      loggedOut: 'À bientôt !',
      required: 'Remplis ton e-mail et ton mot de passe.',
    },
    errors: {
      invalid_credentials: 'E-mail ou mot de passe incorrect.',
      email_taken: 'Un compte existe déjà avec cet e-mail.',
      invalid_email: 'Saisis une adresse e-mail valide.',
      weak_password: 'Le mot de passe doit faire entre 8 et 128 caractères.',
      invalid_name: 'Le nom doit faire entre 1 et 24 caractères.',
      too_many_attempts: 'Trop de tentatives ratées. Réessaie dans quelques minutes.',
      not_authenticated: 'Connecte-toi.',
      wrong_password: 'Le mot de passe actuel est incorrect.',
      forbidden: "Ce n'est pas ton joueur.",
      network: 'Impossible de joindre le serveur. Est-il toujours lancé ?',
    },
  },
};

// ── Current language ─────────────────────────────────────────────────────────

function readStoredLang() {
  try {
    return globalThis.localStorage?.getItem(LANG_KEY) ?? null;
  } catch {
    return null;
  }
}

let current = (() => {
  const stored = readStoredLang();
  if (LANGUAGES.includes(stored)) return stored;
  return (globalThis.navigator?.language ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
})();
if (globalThis.document) document.documentElement.lang = current;


export const getLang = () => current;
export const locale = () => (current === 'fr' ? 'fr-FR' : 'en-GB');

export function setLang(lang) {
  if (!LANGUAGES.includes(lang) || lang === current) return;
  current = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* not remembered in private mode */
  }
  window.dispatchEvent(new CustomEvent('mb:lang', { detail: lang }));
}

// ── Lookup ───────────────────────────────────────────────────────────────────

function lookup(lang, key) {
  return key.split('.').reduce((node, part) => (node == null ? node : node[part]), DICT[lang]);
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

function translate(key, params, escapeParams) {
  let entry = lookup(current, key) ?? lookup('en', key);
  if (entry == null) return key;
  if (typeof entry === 'object') {
    const form = new Intl.PluralRules(current).select(params?.count ?? 0);
    entry = entry[form] ?? entry.other;
  }
  return String(entry).replace(/\{(\w+)\}/g, (match, name) => {
    if (!params || !(name in params)) return match;
    return escapeParams ? escape(params[name]) : String(params[name]);
  });
}

/** Plain text (escape it like any other text when putting it in HTML). */
export const t = (key, params) => translate(key, params, false);

/** A translation that contains HTML markup; the params are escaped. Wrap it in raw(). */
export const tHtml = (key, params) => translate(key, params, true);

export const has = (key) => lookup(current, key) != null || lookup('en', key) != null;

// ── Game vocabulary ──────────────────────────────────────────────────────────

export const rarityName = (id) => t(`rarities.${id}`);
export const typeName = (id) => t(`types.${id}`);
export const eraName = (id) => t(`eras.${id}`);
export const setName = (id) => t(`sets.${id}.name`);
export const setTagline = (id) => t(`sets.${id}.tagline`);

/** The card texts in the current language (French Wikipedia texts when they exist). */
export function cardText(card) {
  const fr = current === 'fr' ? card.fr : null;
  return {
    name: fr?.name ?? card.name,
    description: fr ? fr.description : card.description,
    short: fr?.short ?? card.short,
    summary: fr?.summary ?? card.summary,
    wikipediaUrl: fr?.wikipediaUrl ?? card.wikipediaUrl,
    translated: current === 'en' || Boolean(fr),
  };
}

/** A translated message for an API error (falls back to the server's English message). */
export function errorText(err) {
  if (err?.code && has(`errors.${err.code}`)) return t(`errors.${err.code}`);
  return err?.message ?? String(err);
}
