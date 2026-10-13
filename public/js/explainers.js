// Short explainer "videos", played live on the 3D model: the camera moves to each part while captions run
// (and, if the visitor turns it on, the browser reads them aloud in English or Hindi).
// Every video uses the same 5 parts: what it is, why the hospital needs it, how it works,
// what WIESPL does differently, what is included. Facts come from the WIESPL product descriptions and terms.
//
// To show real site footage as well, paste a YouTube (unlisted) link into `youtube`.
// `act` moves the 3D: overview | ahu | explode | anatomy | airflow | build | focus:<part>
// `feature` is what "＋ Add this to my enquiry" adds.
export const VIDEOS = {
  shrm: {
    title: 'SHRM – Smart Heat Recovery', hiTitle: 'SHRM – स्मार्ट हीट रिकवरी', feature: 'shrm', youtube: '',
    scenes: [
      { ch: 'What it is', hiCh: 'यह क्या है', act: 'focus:shrm',
        en: 'SHRM is WIESPL’s patented Smart Heat Recovery Management system. It sits inside the AHU, right after the cooling coil.',
        hi: 'SHRM, WIESPL का पेटेंटेड स्मार्ट हीट रिकवरी मैनेजमेंट सिस्टम है। यह AHU के अंदर, कूलिंग कॉइल के ठीक बाद लगता है।' },
      { ch: 'Why you need it', hiCh: 'क्यों ज़रूरी है', act: 'focus:ahu_coil',
        en: 'An OT must stay dry: NABH allows 20 to 60% humidity. To remove moisture the coil over-cools the air, and most systems then run electric heaters all day to warm it back up.',
        hi: 'OT में नमी कम रखनी होती है: NABH 20 से 60% ह्यूमिडिटी की अनुमति देता है। नमी निकालने के लिए कॉइल हवा को ज़्यादा ठंडा करती है, और ज़्यादातर सिस्टम उसे वापस गर्म करने के लिए दिन भर इलेक्ट्रिक हीटर चलाते हैं।' },
      { ch: 'How it works', hiCh: 'कैसे काम करता है', act: 'focus:shrm',
        en: 'SHRM re-warms the dried air with heat that is already available inside the system, instead of electric heaters. The PLC controls it, so humidity stays precise and steady.',
        hi: 'SHRM सूखी हुई हवा को इलेक्ट्रिक हीटर की जगह सिस्टम में पहले से मौजूद गर्मी से दोबारा गर्म करता है। PLC इसे कंट्रोल करता है, इसलिए ह्यूमिडिटी सटीक और स्थिर रहती है।' },
      { ch: 'What is different', hiCh: 'WIESPL में क्या अलग है', act: 'focus:ahu_heat',
        en: 'It is patented by WIESPL. No electric heater bank means no extra electrical load, lower power bills, and less maintenance, because there are no heating elements to fail.',
        hi: 'यह WIESPL का पेटेंट है। इलेक्ट्रिक हीटर बैंक नहीं, यानी बिजली पर कोई अतिरिक्त लोड नहीं, बिजली का बिल कम, और मेंटेनेंस भी कम, क्योंकि खराब होने के लिए कोई हीटिंग एलिमेंट नहीं है।' },
      { ch: 'What you get', hiCh: 'आपको क्या मिलता है', act: 'focus:control',
        en: 'SHRM comes built into the WIESPL AHU, works with the PLC-based HVAC panel, and is checked during validation. It is optional: add it to your enquiry below.',
        hi: 'SHRM, WIESPL AHU में ही लगा आता है, PLC आधारित HVAC पैनल के साथ काम करता है, और वैलिडेशन में जाँचा जाता है। यह ऑप्शनल है: नीचे बटन से इसे अपनी इन्क्वायरी में जोड़ें।' },
    ],
  },
  ahu: {
    title: 'The AHU, explained', hiTitle: 'AHU की पूरी जानकारी', feature: 'ahu', youtube: '',
    scenes: [
      { ch: 'What it is', hiCh: 'यह क्या है', act: 'ahu',
        en: 'The air handling unit is the lungs of the OT. It filters, cools, dries and pushes the air. WIESPL builds its own AHUs at its Pune works.',
        hi: 'एयर हैंडलिंग यूनिट OT के फेफड़े हैं। यह हवा को फ़िल्टर करती है, ठंडा करती है, सुखाती है और आगे भेजती है। WIESPL अपने AHU अपनी पुणे फैक्ट्री में बनाता है।' },
      { ch: 'Why you need it', hiCh: 'क्यों ज़रूरी है', act: 'anatomy',
        en: 'NABH asks for at least 20 air changes an hour, positive pressure day and night, and a dedicated AHU for every OT. The AHU does all of this.',
        hi: 'NABH के अनुसार हर घंटे कम से कम 20 एयर चेंज, दिन-रात पॉज़िटिव प्रेशर, और हर OT के लिए अलग AHU चाहिए। AHU यही सब करता है।' },
      { ch: 'How it works', hiCh: 'कैसे काम करता है', act: 'explode',
        en: 'Air passes the pre-filter and the fine filter, then the cooling coil, the SHRM, the plug fan and the UV lamps, and goes on to the HEPA filters above the table.',
        hi: 'हवा पहले प्री-फ़िल्टर और फ़ाइन फ़िल्टर से, फिर कूलिंग कॉइल, SHRM, प्लग फ़ैन और UV लैंप से गुज़रती है, और फिर टेबल के ऊपर HEPA फ़िल्टर तक जाती है।' },
      { ch: 'What is different', hiCh: 'WIESPL में क्या अलग है', act: 'focus:ahu_fan',
        en: '45 mm double-skin PUF panels, hybrid DX and chilled-water coils, an SS 304 drain pan, a quiet plug fan on a VFD-ready motor, a plasma filter and germicidal UV.',
        hi: '45 mm डबल-स्किन PUF पैनल, हाइब्रिड DX और चिल्ड-वॉटर कॉइल, SS 304 ड्रेन पैन, VFD वाली मोटर पर शांत प्लग फ़ैन, प्लाज़्मा फ़िल्टर और जर्मीसाइडल UV।' },
      { ch: 'What you get', hiCh: 'आपको क्या मिलता है', act: 'anatomy',
        en: 'You get the AHU with its outdoor unit, the ducting, the return air risers, the IP65 HVAC control panel, optional iSmart remote monitoring, and full testing at handover.',
        hi: 'आपको आउटडोर यूनिट के साथ AHU, डक्टिंग, रिटर्न एयर राइज़र, IP65 HVAC कंट्रोल पैनल, ऑप्शनल iSmart रिमोट मॉनिटरिंग, और हैंडओवर पर पूरी टेस्टिंग मिलती है।' },
    ],
  },
  doors: {
    title: 'Hermetic sliding door', hiTitle: 'हर्मेटिक स्लाइडिंग डोर', feature: 'doors', youtube: '',
    scenes: [
      { ch: 'What it is', hiCh: 'यह क्या है', act: 'focus:doors',
        en: 'A hermetically sealed, automatic sliding door in SS 304, mounted flush with the wall on both sides.',
        hi: 'SS 304 का हर्मेटिकली सील्ड, ऑटोमैटिक स्लाइडिंग डोर, जो दोनों तरफ़ दीवार के साथ फ़्लश लगता है।' },
      { ch: 'Why you need it', hiCh: 'क्यों ज़रूरी है', act: 'focus:doors',
        en: 'Every time a door opens, corridor air can rush in and the OT loses pressure. A sealed, quick door protects the positive pressure NABH asks for.',
        hi: 'हर बार दरवाज़ा खुलने पर बाहर की हवा अंदर आ सकती है और OT का प्रेशर गिरता है। सील्ड और तेज़ दरवाज़ा NABH वाला पॉज़िटिव प्रेशर बनाए रखता है।' },
      { ch: 'How it works', hiCh: 'कैसे काम करता है', act: 'focus:doors',
        en: 'A microprocessor sets the speed and direction. A low-noise motor slides the 60 mm leaf on nylon wheels in an aluminium track, and it seals as it closes.',
        hi: 'माइक्रोप्रोसेसर स्पीड और दिशा तय करता है। कम आवाज़ वाली मोटर 60 mm के दरवाज़े को एल्युमिनियम ट्रैक में नायलॉन व्हील पर सरकाती है, और बंद होते ही यह सील हो जाता है।' },
      { ch: 'What is different', hiCh: 'WIESPL में क्या अलग है', act: 'focus:doors',
        en: 'Photocell sensors stop the door if anyone is in the way. The blade has 48 mm PUF insulation with SS 304 on both faces, and a push-pull handle for manual use.',
        hi: 'रास्ते में कोई हो तो फ़ोटोसेल सेंसर दरवाज़ा रोक देते हैं। दरवाज़े में 48 mm PUF इंसुलेशन, दोनों तरफ़ SS 304, और हाथ से खोलने के लिए पुश-पुल हैंडल है।' },
      { ch: 'What you get', hiCh: 'आपको क्या मिलता है', act: 'overview',
        en: 'Supplied and installed in your size, for example 1200 or 1800 by 2100 mm, with the operator, track and controls. You provide the power point shown in our drawing.',
        hi: 'आपके साइज़ में, जैसे 1200 या 1800 × 2100 mm, ऑपरेटर, ट्रैक और कंट्रोल के साथ सप्लाई और इंस्टॉल। हमारी ड्रॉइंग के अनुसार पावर पॉइंट आप देते हैं।' },
    ],
  },
  passbox: {
    title: 'Pass box', hiTitle: 'पास बॉक्स', feature: 'passbox', youtube: '',
    scenes: [
      { ch: 'What it is', hiCh: 'यह क्या है', act: 'focus:passbox',
        en: 'A pass box is a small stainless steel cabinet in the OT wall, used to pass instruments and samples in or out.',
        hi: 'पास बॉक्स OT की दीवार में लगा छोटा स्टेनलेस स्टील का कैबिनेट है, जिससे औज़ार और सैंपल अंदर-बाहर दिए जाते हैं।' },
      { ch: 'Why you need it', hiCh: 'क्यों ज़रूरी है', act: 'focus:passbox',
        en: 'Staff do not have to open the main door, so the OT keeps its pressure and its sterility during surgery.',
        hi: 'स्टाफ़ को मुख्य दरवाज़ा खोलना नहीं पड़ता, इसलिए सर्जरी के दौरान OT का प्रेशर और स्टेरिलिटी बनी रहती है।' },
      { ch: 'How it works', hiCh: 'कैसे काम करता है', act: 'focus:passbox',
        en: 'Its two doors are interlocked: while one door is open, the other cannot be opened. A UV tube sterilises what is placed inside.',
        hi: 'इसके दोनों दरवाज़े इंटरलॉक होते हैं: एक खुला हो तो दूसरा नहीं खुलता। अंदर रखी चीज़ों को UV ट्यूब स्टेरलाइज़ करती है।' },
      { ch: 'What is different', hiCh: 'WIESPL में क्या अलग है', act: 'focus:passbox',
        en: 'A mechanical interlock: maintenance-free and fail-safe. Medical-grade SS 304 body and base, and double-skin doors with a 300 by 300 mm glass.',
        hi: 'मैकेनिकल इंटरलॉक: बिना मेंटेनेंस और फ़ेल-सेफ़। मेडिकल-ग्रेड SS 304 बॉडी और बेस, और 300 × 300 mm काँच वाले डबल-स्किन दरवाज़े।' },
      { ch: 'What you get', hiCh: 'आपको क्या मिलता है', act: 'focus:passbox',
        en: 'An inside size of about 497 mm each way, fitted flush in the wall with its UV tube. Choose how many you need in your enquiry.',
        hi: 'अंदर से लगभग 497 mm का साइज़, UV ट्यूब के साथ दीवार में फ़्लश लगा हुआ। इन्क्वायरी में बताएँ कि कितने चाहिए।' },
    ],
  },
  laf: {
    title: 'Laminar air flow + HEPA', hiTitle: 'लैमिनार एयर फ़्लो + HEPA', feature: 'laf', youtube: '',
    scenes: [
      { ch: 'What it is', hiCh: 'यह क्या है', act: 'focus:laf',
        en: 'Laminar air flow is a gentle, straight-down column of clean air over the operating table.',
        hi: 'लैमिनार एयर फ़्लो ऑपरेशन टेबल के ऊपर सीधी नीचे आती साफ़ हवा का एक हल्का स्तंभ है।' },
      { ch: 'Why you need it', hiCh: 'क्यों ज़रूरी है', act: 'airflow',
        en: 'It sweeps dust and bacteria away from the open wound. NABH asks for unidirectional, downward air on the OT table and HEPA filters in the ceiling.',
        hi: 'यह खुले घाव से धूल और बैक्टीरिया को दूर ले जाती है। NABH के अनुसार टेबल पर एक दिशा में नीचे की ओर हवा और छत में HEPA फ़िल्टर होने चाहिए।' },
      { ch: 'How it works', hiCh: 'कैसे काम करता है', act: 'anatomy',
        en: 'The AHU pushes air into the stainless steel plenum. H14 HEPA filters clean it and the diffuser spreads it evenly. Used air leaves low down through the return risers.',
        hi: 'AHU हवा को स्टेनलेस स्टील प्लेनम में भेजता है। H14 HEPA फ़िल्टर उसे साफ़ करते हैं और डिफ़्यूज़र उसे बराबर फैलाता है। इस्तेमाल हुई हवा नीचे रिटर्न राइज़र से बाहर जाती है।' },
      { ch: 'What is different', hiCh: 'WIESPL में क्या अलग है', act: 'focus:velocity',
        en: 'SS 304 plenum and diffuser for uniform velocity, DOP-tested mini-pleat H14 HEPA filters, LED light boxes on all four sides, and an air velocity sensor.',
        hi: 'एक जैसी वेलोसिटी के लिए SS 304 प्लेनम और डिफ़्यूज़र, DOP टेस्टेड मिनी-प्लीट H14 HEPA फ़िल्टर, चारों तरफ़ LED लाइट बॉक्स, और एयर वेलोसिटी सेंसर।' },
      { ch: 'What you get', hiCh: 'आपको क्या मिलता है', act: 'focus:hepa',
        en: 'A plenum sized to your OT, from 6 by 8 up to 10 by 10 feet, with filters and lighting, and validation: particle count to ISO Class 5 and room pressure of 2.5 to 5 pascal.',
        hi: 'आपके OT के हिसाब से 6 × 8 से 10 × 10 फ़ुट तक का प्लेनम, फ़िल्टर और लाइटिंग के साथ, और वैलिडेशन: ISO क्लास 5 पार्टिकल काउंट और 2.5 से 5 पास्कल रूम प्रेशर।' },
    ],
  },
  delivery: {
    title: 'What you receive from WIESPL', hiTitle: 'WIESPL से आपको क्या मिलता है', feature: null, youtube: '',
    scenes: [
      { ch: 'Design', hiCh: 'डिज़ाइन', act: 'overview',
        en: 'Step 1, design: we study your space and send a layout and a basis of design for every OT: air changes, cooling, filters and finishes.',
        hi: 'पहला कदम, डिज़ाइन: हम आपकी जगह देखते हैं और हर OT के लिए लेआउट और बेसिस ऑफ़ डिज़ाइन भेजते हैं: एयर चेंज, कूलिंग, फ़िल्टर और फ़िनिश।' },
      { ch: 'Supply', hiCh: 'सप्लाई', act: 'ahu',
        en: 'Step 2, supply: the AHU is built at our Pune works, and the panels, plenum, doors and controls are made to your drawing. Material usually ships 4 to 5 weeks after the confirmed order.',
        hi: 'दूसरा कदम, सप्लाई: AHU हमारी पुणे फैक्ट्री में बनता है, और पैनल, प्लेनम, दरवाज़े और कंट्रोल आपकी ड्रॉइंग के अनुसार बनते हैं। कन्फ़र्म ऑर्डर के बाद सामान आमतौर पर 4 से 5 हफ़्ते में भेजा जाता है।' },
      { ch: 'Installation', hiCh: 'इंस्टॉलेशन', act: 'build',
        en: 'Step 3, installation: our team lays the floor, puts up the walls and ceiling, fits the laminar flow, pendants and lights, and connects the ducts and the AHU.',
        hi: 'तीसरा कदम, इंस्टॉलेशन: हमारी टीम फ़्लोर बिछाती है, दीवारें और छत लगाती है, लैमिनार फ़्लो, पेंडेंट और लाइट फ़िट करती है, और डक्ट व AHU जोड़ती है।' },
      { ch: 'Testing', hiCh: 'टेस्टिंग', act: 'focus:laf',
        en: 'Step 4, testing: we validate the OT: particle count to ISO Class 5 at the HEPA filters, air changes, air velocity, and room pressure of 2.5 to 5 pascal.',
        hi: 'चौथा कदम, टेस्टिंग: हम OT का वैलिडेशन करते हैं: HEPA पर ISO क्लास 5 पार्टिकल काउंट, एयर चेंज, एयर वेलोसिटी, और 2.5 से 5 पास्कल रूम प्रेशर।' },
      { ch: 'Handover', hiCh: 'हैंडओवर', act: 'focus:control',
        en: 'Step 5, handover: we train your OT staff on the control panel and hand over the test reports. Service is free during the warranty period.',
        hi: 'पाँचवाँ कदम, हैंडओवर: हम आपके OT स्टाफ़ को कंट्रोल पैनल चलाना सिखाते हैं और टेस्ट रिपोर्ट सौंपते हैं। वारंटी के दौरान सर्विस मुफ़्त है।' },
    ],
  },
};

// which video a tapped part opens
export const VIDEO_FOR = { shrm: 'shrm', ahu: 'ahu', ahu_pre: 'ahu', ahu_fine: 'ahu', ahu_coil: 'ahu', ahu_fan: 'ahu', ahu_heat: 'ahu', odu: 'ahu', ducts: 'ahu', doors: 'doors', passbox: 'passbox', laf: 'laf', hepa: 'laf', velocity: 'laf' };

// seconds a caption stays up without the voice (about 12 characters a second, at least 6 s)
export const sceneSecs = s => Math.max(6, Math.round(s.en.length / 12));
export const videoSecs = key => VIDEOS[key].scenes.reduce((t, s) => t + sceneSecs(s), 0);
export const fmtSecs = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
