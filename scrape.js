import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TARGET_FACILITIES = [
    "Gregory Gym",
    "Recreational Sports Center"
];

async function scrapeHours() {
    const res = await fetch("https://www.utrecsports.org/hours");
    const html = await res.text();
    const $ = cheerio.load(html);

    const seasonLabel = $('h3')
        .filter((i, el) => $(el).text().includes('Term'))
        .first()
        .text()
        .trim();

    const hoursData = []

    $('a').each((i, el) => {
        const name = $(el).text().trim();
        if (!TARGET_FACILITIES.includes(name)) {
            return;
        }

        const rowText = $(el).parent().text().replace(name, '').trim();
        const parts = rowText.split(/\s{2,}|\n/).map(p => p.trim()).filter(Boolean);

        if (parts.length < 4) {
            console.warn('Unexpected hours format for', name, parts);
            return;
        }

        const [monThu, fri, sat, sun] = parts;

        hoursData.push({
            name,
            monThu,
            fri,
            sat,
            sun,
            seasonLabel
        });

        return hoursData;
    })
}

async function scrapeFacilityMeta(facilityUrl) {
    const res = await fetch(facilityUrl);
    const html = res.text();
    const $ = cheerio.load(html);

    function extractListAfterHeading(headingText) {
        const heading = $('h2', 'h3', 'h4')
            .filter((i, el) => $(el).text().includes(headingText))
            .first();

        if (!heading.length) return [];

        const list = heading.nextAll('ul').first();

        const items = [];
        list.find('li').each((i, li) => {
            items.push($(li).text().trim());
        });
        return items;
    
    }

    const activities = extractListAfterHeading('Activities at this Facility');
    const features = extractListAfterHeading('Features');

    return { activities, features };
}

// main runner function:

async function main() {
    console.log("Scraping hours right now.");
    const hoursRows = await scrapeHours();

    for (const row of hoursRows) {
        console.log("processing this row: ", row.name);

        const { data: facility, error: fErr} = await supabase
            .from('facilities')
            .select('*')
            .eq('name', row.name)
            .maybeSingle();
        if (fErr || !facility) {
            console.error("No row for ", row.name, fErr);
            continue;
        }

        const { error: hErr } = await supabase.from('facility_hours').insert({
            facility_id: facility.id,
            season_label: row.seasonLabel,
            mon_thu: row.monThu,
            fri: row.fri,
            sat: row.sat,
            sun: row.sun,
            // it generally is the case that mon-thu keeps the same dates
        })
        if (hErr) {
            console.error("error inserting hours for ", row.name, hErr);
        }

        if (facility.facility_url) {
            console.log("scraping metadata from ", facility.facility_url);
            const meta = await scrapeFacilityMeta(facility.facility_url);

            const { erorr: mErr } = await supabase.from('facility_meta').insert({
                facility_id: facility.id,
                activities: meta.activities,
                features: meta.features,
            });

            if (mErr) console.error("Error inserting metadata ", row.name, mErr);
        }
    }


    console.log("finished!! Hooray!");
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

