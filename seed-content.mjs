#!/usr/bin/env node
// Emits SQL that seeds/refreshes the site_content table from data/*.json.
// Run: node seed-content.mjs > /tmp/seed.sql  (then apply via Supabase SQL)
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const rows = [];

for (const f of readdirSync(join(ROOT, 'data/categories')).sort()) {
  const key = basename(f, '.json');
  const data = readFileSync(join(ROOT, 'data/categories', f), 'utf8');
  rows.push({ key, data: JSON.parse(data) });
}

const site = JSON.parse(readFileSync(join(ROOT, 'data/site.json'), 'utf8'));
rows.push({
  key: 'pages',
  data: {
    home: {
      eyebrow: 'Bathroomware, considered',
      heading: 'Designed to inspire',
      lede: 'Thoughtful interiors created by striking & beautiful bathroomware — a complete and coordinated collection, finished to the finest detail.'
    },
    about: {
      heading: 'Founded on experience & passion',
      sections: [
        {
          side: 'Who we are',
          paras: [
            'Founded on experience & passion, ARMERA is the creation of a committed and personable team with over 20 years’ experience in bathrooms, product design and interiors. Our promise is to provide considered design in form and function, a complete and seductive offering, and a close partnership-approach with our customers.',
            'Our approach towards our sales channel is to partner with retailers ensuring the final customer receives great advice and service. Our partnership distribution strategy, devotion to detailed design, and trusted personal service embodies who we are.'
          ]
        },
        {
          side: 'Our design process',
          paras: [
            'Our design process is born out of genuine passion and love of our products. We have listened and learnt from the market, from end consumers to installers, retailers to project specifiers, interior designers and contract partners. We have engineered new technologies and solutions that make life safer and easier. We have designed products to create well-proportioned, beautiful bathroomware which delivers a superior experience.',
            'We are not always trying to re-invent the wheel, we also sensibly look at what already works well, and make it better by focusing on the design detail, striking a perfect balance between old and new.'
          ]
        },
        {
          side: 'Finishes',
          paras: [
            'We offer special finishes coordinated across the entire range. Special finish options include the sleek brushed black, an elegant brushed gold and the smart brushed stainless steel. Customers can match their brassware in their chosen finish to accessories, flush plates, toilet hinge cover caps, basin wastes and overflows. We have an array of colour and finish options for our furniture, ranging from our opulent Walnut Noir to the contemporary Cavern Blue.'
          ]
        },
        {
          side: 'Manufacturing',
          paras: [
            'Manufacturing is in accordance with the strictest of quality processes and standards, implemented with years of experience in this field. This results in true manufacturing excellence, culminating in guaranteed technically and aesthetically superior products.',
            'Our products conform to the Water Regulatory Advisory Scheme (WRAS), and are designed and manufactured with sustainability in mind, incorporating water-saving and flow-regulated technology. All of our products are quality-guaranteed.'
          ]
        },
        {
          side: 'In partnership',
          paras: [
            'We love our industry, our business, our products and our customers. Thanks for working in partnership with ARMERA to ultimately provide a gratifying and superior bathroom experience.'
          ]
        }
      ]
    },
    support: { spares: 'For spares, please contact us on 01225 251204 for advice on spares.' },
    contact: { phone: site.phone, email: site.email, address: site.address }
  }
});

for (const r of rows) {
  const json = JSON.stringify(r.data);
  if (json.includes('$seed$')) throw new Error('dollar-quote collision');
  console.log(`insert into public.site_content (key, data) values ('${r.key}', $seed$${json}$seed$::jsonb)
on conflict (key) do update set data = excluded.data, updated_at = now();`);
}
