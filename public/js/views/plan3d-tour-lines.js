// What the explainer tour of a CAD drawing says, step by step. `show` is the caption on screen; `say` is what the
// voice reads (spelled the way it should sound). The voice clips are public/audio/tour/<key>.mp3, made from `say`
// with tools/tour-voice.mjs. Facts come from the WIESPL product descriptions (public/js/parts.js).
export const TOUR_LINES = {
  corridor_intro: {
    title: 'Sterile corridor',
    show: 'Welcome to your WIESPL modular OT complex. The walk-through starts in the sterile corridor: the clean passage the team uses to reach every theatre.',
    say: 'Welcome to your Wee-spell modular O.T. complex. The walk-through starts in the sterile corridor, the clean passage the team uses to reach every theatre.',
  },
  corridor_sky: {
    title: 'Sky ceiling',
    show: 'Overhead, backlit sky-ceiling panels bring nature indoors: tree canopies, blossoms and open sky keep the passage bright and calm for patients and staff.',
    say: 'Overhead, backlit sky ceiling panels bring nature indoors. Tree canopies, blossoms and open sky keep the passage bright and calm, for patients and staff.',
  },
  corridor_air: {
    title: 'Air diffusers',
    show: 'Between them, ceiling diffusers supply filtered, conditioned air. The corridor is kept at a lower pressure than the theatres, so air always flows out of an OT, never in.',
    say: 'Between them, ceiling diffusers supply filtered, conditioned air. The corridor is kept at a lower pressure than the theatres, so air always flows out of an O.T., never in.',
  },
  corridor_scrub: {
    title: 'Scrub station',
    show: 'Just outside the theatre, the team scrubs at a hands-free surgical scrub station in the passage, with sensor or foot-operated taps, in one, two or three bays.',
    say: 'Just outside the theatre, the team scrubs at a hands free surgical scrub station in the passage, with sensor or foot operated taps, in one, two, or three bays.',
  },
  corridor_finish: {
    title: 'Passage floor and walls',
    show: 'The passage floor is seamless vinyl with welded joints and a contrasting border, and the walls are coved and easy to clean, so the whole route can be disinfected.',
    say: 'The passage floor is seamless vinyl, with welded joints and a contrasting border. The walls are coved and easy to clean, so the whole route can be disinfected.',
  },
  door_closed: {
    title: 'OT door',
    show: 'Every theatre has a WIESPL OT door: SS 304 on both faces, 48 mm PUF insulation, and vision panels so staff can look in before they enter.',
    say: 'Every theatre has a Wee-spell O.T. door. S.S. three-oh-four on both faces, forty-eight millimetre P.U.F. insulation, and vision panels, so staff can look in before they enter.',
  },
  door_options: {
    title: 'Door options',
    show: 'WIESPL makes the OT door to suit each theatre: a hermetic sliding door, or a double-leaf swing door with vision panels, in widths such as 1200, 1500 or 1800 mm.',
    say: 'Wee-spell makes the O.T. door to suit each theatre. A hermetic sliding door, or a double leaf swing door with vision panels, in widths such as twelve hundred, fifteen hundred, or eighteen hundred millimetres.',
  },
  door_open_sliding: {
    title: 'Hermetic sliding door',
    show: 'The hermetic sliding door opens automatically, with a low-noise motor and photocell safety sensors, then seals again to hold the theatre’s positive pressure.',
    say: 'The hermetic sliding door opens automatically, with a low noise motor and photocell safety sensors, then seals again, to hold the theatre’s positive pressure.',
  },
  door_open_swing: {
    title: 'Swing door',
    show: 'The door opens wide for the patient trolley, and closes behind the team to hold the theatre’s positive pressure.',
    say: 'The door opens wide for the patient trolley, and closes behind the team, to hold the theatre’s positive pressure.',
  },
  ot_intro: {
    title: 'Operation theatre',
    show: 'Inside the operation theatre, every wall is a modular PUF-insulated panel with rounded coving at each corner: joint-free, with nowhere for germs to hide.',
    say: 'Inside the operation theatre, every wall is a modular, P.U.F. insulated panel, with rounded coving at each corner. Joint free, with nowhere for germs to hide.',
  },
  ot_walls: {
    title: 'Wall panels',
    show: 'Walls can be stainless steel SS 304, PPGL, back-painted toughened glass, or steel up to dado height with glass above. Everything on the wall sits flush.',
    say: 'Walls can be stainless steel, S.S. three-oh-four, P.P.G.L., back painted toughened glass, or steel up to dado height with glass above. Everything on the wall sits flush.',
  },
  ot_picture: {
    title: 'Picture glass panel',
    show: 'A printed picture-glass panel turns one wall into a calm scene, such as a blossom avenue, a mountain lake or a sunlit forest, giving the patient something peaceful to look at before surgery.',
    say: 'A printed picture glass panel turns one wall into a calm scene, such as a blossom avenue, a mountain lake, or a sunlit forest, giving the patient something peaceful to look at before surgery.',
  },
  ot_floor: {
    title: 'Seamless floor',
    show: 'The floor is seamless vinyl on a self-levelling base, antistatic or homogeneous, with welded joints and coving up the walls, so the theatre can be fully disinfected.',
    say: 'The floor is seamless vinyl on a self levelling base, antistatic or homogeneous, with welded joints and coving up the walls, so the theatre can be fully disinfected.',
  },
  ot_floor_colours: {
    title: 'Floor colours',
    show: 'The main floor and its border are chosen separately from six colours: for example beige with a grey border, sky blue with navy, aqua green with grey, or light grey with navy.',
    say: 'The main floor and its border are chosen separately, from six colours. For example, beige with a grey border, sky blue with navy, aqua green with grey, or light grey with navy.',
  },
  ot_laf: {
    title: 'Laminar air flow and HEPA',
    show: 'Over the table, the stainless steel laminar air flow plenum sends clean air straight down across the surgical field, through H14 HEPA filters tested down to 0.3 micron.',
    say: 'Over the table, the stainless steel laminar air flow plenum sends clean air straight down across the surgical field, through H fourteen HEPA filters, tested down to zero point three micron.',
  },
  ot_return: {
    title: 'Return air risers',
    show: 'Used air leaves low down through return-air risers near the floor, drawing contamination away from the patient and back to the air handling unit.',
    say: 'Used air leaves low down, through return air risers near the floor, drawing contamination away from the patient, and back to the air handling unit.',
  },
  ot_light: {
    title: 'LED OT light',
    show: 'Shadow-free LED OT lights on balanced arms focus on the operating field.',
    say: 'Shadow free L.E.D. O.T. lights, on balanced arms, focus on the operating field.',
  },
  ot_pendants: {
    title: 'Ceiling pendants',
    show: 'Ceiling pendants bring medical gases, power and data to the surgeon and the anaesthetist, so nothing trails across the floor.',
    say: 'Ceiling pendants bring medical gases, power and data to the surgeon and the anaesthetist, so nothing trails across the floor.',
  },
  ot_panel: {
    title: 'Surgeon’s control panel',
    show: 'On the wall, the flush surgeon’s control panel shows temperature and humidity, HEPA filter health and all seven medical gases, and runs the lights, timer and music. Beside it is an LED X-ray viewer.',
    say: 'On the wall, the flush surgeon’s control panel shows temperature and humidity, HEPA filter health and all seven medical gases, and runs the lights, timer and music. Beside it is an L.E.D. X-ray viewer.',
  },
  ot_full: {
    title: 'The complete theatre',
    show: 'And here is the complete operation theatre, with every part in place: wall panels, seamless floor, laminar air flow, lights, pendants and controls, ready for surgery.',
    say: 'And here is the complete operation theatre, with every part in place. Wall panels, seamless floor, laminar air flow, lights, pendants and controls, ready for surgery.',
  },
  ot_outro: {
    title: 'WIESPL',
    show: 'From the corridor to the table, every part is designed, built and installed by WIESPL. Turnkey solutions for healthcare.',
    say: 'From the corridor to the table, every part is designed, built and installed by Wee-spell. Turnkey solutions for healthcare.',
  },
};
