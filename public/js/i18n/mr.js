// Marathi dictionary for the CRM screens (see ../i18n.js). Split in parts only to keep the files readable;
// a later part wins when the same English text appears twice.
import p1 from './mr1.js';
import p2 from './mr2.js';
import p3 from './mr3.js';
import p4 from './mr4.js';
import p5 from './mr5.js';
import p6 from './mr6.js';

export default { ...p1, ...p2, ...p3, ...p4, ...p5, ...p6 };

const NEW = { Enquiry: 'चौकशी', Customer: 'ग्राहक', Contact: 'संपर्क', Quotation: 'कोटेशन', 'Purchase Order': 'खरेदी ऑर्डर', Vendor: 'पुरवठादार', Employee: 'कर्मचारी', Complaint: 'तक्रार', Task: 'काम', Item: 'वस्तू' };

// texts built with numbers or names inside them
export const PATTERNS = [
  [/^(\d+) of (\d+) sections complete$/, '$2 पैकी $1 विभाग पूर्ण'],
  [/^(\d+) \/ (\d+) completed$/, '$2 पैकी $1 पूर्ण'],
  [/^Enquiry: (.+)$/, 'चौकशी: $1'], [/^Quotation: (.+)$/, 'कोटेशन: $1'], [/^Customer: (.+)$/, 'ग्राहक: $1'], [/^Purchase Order: (.+)$/, 'खरेदी ऑर्डर: $1'],
  [/^New (Enquiry|Customer|Contact|Quotation|Purchase Order|Vendor|Employee|Complaint|Task|Item)$/, (m, w) => `नवीन ${NEW[w]}`],
  [/^(\d+) won · (\d+) lost\/regret$/, '$1 मिळाले · $2 गमावले/नकार'],
  [/^(\d+) items below minimum$/, '$1 वस्तू किमानपेक्षा कमी'],
  [/^(\d+) records?$/, '$1 नोंदी'],
];
