// Linx WordFinder sample puzzles: the server falls back to these when a day has no approved puzzle and the
// backup pool is empty. Kept under api/ so the answers are never served to browsers.
// Each has an English and a Spanish version on the same topic.
(function (root) {
  var samples = [
    { id: "sample-countries", difficulty: "easy",
      en: { topic: "Countries", words: [
        { word: "ARGENTINA", hint: "Tango, Patagonia and the Andes on its western edge." },
        { word: "PERU", hint: "Home of Machu Picchu." },
        { word: "GERMANY", hint: "Bratwurst and the Brandenburg Gate." },
        { word: "LUXEMBOURG", hint: "A small grand duchy in the heart of Europe." },
        { word: "FRANCE", hint: "Its capital has a famous iron tower." },
        { word: "CHINA", hint: "Its great wall is thousands of miles long." } ] },
      es: { topic: "Países", words: [
        { word: "ARGENTINA", hint: "Tango, Patagonia y los Andes en su frontera oeste." },
        { word: "PERÚ", hint: "Aquí está Machu Picchu." },
        { word: "ALEMANIA", hint: "Salchichas y la Puerta de Brandeburgo." },
        { word: "LUXEMBURGO", hint: "Un pequeño gran ducado en el corazón de Europa." },
        { word: "FRANCIA", hint: "Su capital tiene una famosa torre de hierro." },
        { word: "CHINA", hint: "Su gran muralla mide miles de kilómetros." } ] } },
    { id: "sample-fruit", difficulty: "easy",
      en: { topic: "Fruit", words: [
        { word: "BANANA", hint: "Yellow, curved and easy to peel." },
        { word: "MANGO", hint: "Tropical, sweet, with a big flat stone inside." },
        { word: "CHERRY", hint: "Small, red and often sits on top of a sundae." },
        { word: "LEMON", hint: "Sour and yellow; great in lemonade." },
        { word: "GRAPE", hint: "Grows in bunches on a vine." },
        { word: "PEAR", hint: "Wider at the bottom than at the top." } ] },
      es: { topic: "Frutas", words: [
        { word: "PLÁTANO", hint: "Amarillo, curvo y fácil de pelar." },
        { word: "MANGO", hint: "Tropical y dulce, con un hueso grande y plano." },
        { word: "CEREZA", hint: "Pequeña y roja; a veces corona un helado." },
        { word: "LIMÓN", hint: "Ácido y amarillo; ideal para una limonada." },
        { word: "UVA", hint: "Crece en racimos en la vid." },
        { word: "PERA", hint: "Más ancha abajo que arriba." } ] } },
    { id: "sample-instruments", difficulty: "medium",
      en: { topic: "Musical instruments", words: [
        { word: "PIANO", hint: "Eighty-eight black and white keys." },
        { word: "GUITAR", hint: "Six strings, strummed or picked." },
        { word: "VIOLIN", hint: "Played with a bow, tucked under the chin." },
        { word: "DRUM", hint: "You hit it with sticks to keep the beat." },
        { word: "FLUTE", hint: "A silver tube you blow across, held sideways." },
        { word: "TRUMPET", hint: "Brass, with three valves and a bright sound." } ] },
      es: { topic: "Instrumentos musicales", words: [
        { word: "PIANO", hint: "Ochenta y ocho teclas blancas y negras." },
        { word: "GUITARRA", hint: "Seis cuerdas que se rasguean o puntean." },
        { word: "VIOLÍN", hint: "Se toca con arco, apoyado bajo la barbilla." },
        { word: "TAMBOR", hint: "Se golpea con palillos para marcar el ritmo." },
        { word: "FLAUTA", hint: "Un tubo plateado que se toca de lado." },
        { word: "TROMPETA", hint: "De metal, con tres pistones y un sonido brillante." } ] } },
    { id: "sample-sea", difficulty: "medium",
      en: { topic: "Sea creatures", words: [
        { word: "WHALE", hint: "The largest animal that has ever lived." },
        { word: "SHARK", hint: "A fish with rows of teeth and a famous fin." },
        { word: "DOLPHIN", hint: "A clever, playful mammal that clicks and whistles." },
        { word: "OCTOPUS", hint: "Eight arms and a talent for disguise." },
        { word: "CRAB", hint: "Walks sideways on the beach." },
        { word: "SEAL", hint: "Barks, swims and lounges on rocks." } ] },
      es: { topic: "Animales del mar", words: [
        { word: "BALLENA", hint: "El animal más grande que ha existido." },
        { word: "TIBURÓN", hint: "Un pez con filas de dientes y una aleta famosa." },
        { word: "DELFÍN", hint: "Un mamífero listo y juguetón que silba." },
        { word: "PULPO", hint: "Ocho brazos y un don para camuflarse." },
        { word: "CANGREJO", hint: "Camina de lado por la playa." },
        { word: "FOCA", hint: "Ladra, nada y descansa sobre las rocas." } ] } },
  ];
  if (typeof module !== "undefined" && module.exports) module.exports = samples;
  else root.LLX_WF_SAMPLES = samples;
})(typeof window !== "undefined" ? window : this);
