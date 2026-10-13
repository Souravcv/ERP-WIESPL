// OT requirements from NABH "Revised Guidelines for Air Conditioning in Operation Theatres" (Issue 4, 2018),
// plus WHO surgical hand preparation. Used by the client form (enquire.js) and the detailed brief (brief.js).
export const NABH_SOURCE = 'NABH Revised Guidelines for Air Conditioning in Operation Theatres (2018) · WHO Global Guidelines for the Prevention of Surgical Site Infection';

// Type A (erstwhile super-specialty): neurosciences, joint replacement orthopaedics, cardiothoracic, transplant.
const TYPE_A = ['Orthopaedics', 'Cardiac', 'Neuro', 'Transplant', 'Multi-specialty']; // multi-specialty: designed for its most sensitive use
export const otType = specs => ([].concat(specs || []).some(s => TYPE_A.includes(s)) ? 'A' : 'B');

// [feature key, why it is needed, required (true) or recommended]
const NEEDS = [
  ['laf', 'Unidirectional downward air over the table (laminar diffuser)', true],
  ['hepa', 'Terminal HEPA filters, 99.97% at 0.3 µm', true],
  ['pressure', 'Positive pressure of at least 2.5 Pa, day and night', true],
  ['ahu', 'Dedicated AHU with two stages of washable filters', true],
  ['control', 'Display of temperature and humidity inside the OT', false],
  ['automation', 'Records for the 6-monthly validation', false],
  ['scrub', 'Surgical hand preparation before every case (WHO)', false],
];

export function otNorms(specs) {
  const list = [].concat(specs || []);
  const A = otType(list) === 'A';
  const joint = list.includes('Orthopaedics');
  return {
    type: A ? 'A' : 'B',
    title: A ? 'Type A OT (super-specialty)' : 'Type B OT (general)',
    rows: [
      ['Air changes', 'At least 20 per hour, of which at least 4 are fresh air'],
      ['Air flow', 'Unidirectional and downwards on the OT table, 25–35 feet per minute from a non-aspirating laminar diffuser'],
      ['Room pressure', 'Positive, at least 2.5 Pa, in working and non-working hours'],
      ['Filters in the AHU', 'Washable flange-type: 90% down to 10 µm and 99% down to 5 µm'],
      ['HEPA', '99.97% down to 0.3 µm, terminal in the ceiling; the filter area extends at least 1 ft beyond every side of the table'],
      ['Air at the supply grille', A ? 'ISO Class 5 (Class 100) at rest' : 'ISO Class 6 (Class 1000) at rest'],
      ['Temperature', joint ? '18 ± 2 °C for joint replacement, 21 ± 3 °C for other surgery' : '21 ± 3 °C'],
      ['Relative humidity', A ? '20–60% (ideal 55%)' : '20–60%'],
      ['AHU', 'One dedicated AHU per OT (a shared AHU needs a back-up); no window or split ACs'],
      ['Validation', 'Every 6 months to ISO 14644: temperature & RH, particle count, air changes, air velocity, pressure, HEPA tests'],
    ],
    needs: NEEDS.map(([key, why, required]) => ({ key, why, required })),
  };
}

// Infection-sensitivity protocols used by WIESPL (MD's direction, 13 Oct 2026). Multi-specialty OTs are designed
// for the most sensitive specialty that will use them.
const HIGH = ['Transplant', 'Cardiac', 'Neuro', 'Orthopaedics', 'Multi-specialty'];
export function protocolFor(specs) {
  const list = [].concat(specs || []);
  if (list.some(s => HIGH.includes(s))) return { level: 'High', text: 'High infection sensitivity (transplant, cardiac, neuro, orthopaedic): laminar air flow with terminal HEPA over the table, the strictest air protocol.' };
  if (list.includes('Plastic surgery')) return { level: 'Special', text: 'Plastic surgery follows its own protocol: our engineer will advise the air and lighting design for your cases.' };
  if (list.length && list.every(s => s === 'Gynae / Obstetrics')) return { level: 'Lower', text: 'Gynaecology has a lower relative sensitivity (different bacterial growth patterns): a standard clean-air protocol, still to NABH.' };
  return list.length ? { level: 'Standard', text: 'Standard clean-air protocol to NABH for general surgical work.' } : null;
}
