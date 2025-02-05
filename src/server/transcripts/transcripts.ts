import { prisma_client as prisma } from '../../hooks.server';
import fs, { readFile } from 'fs/promises';
import path from 'path';
import { error } from '@sveltejs/kit';
import type { PrerecordedTranscriptionResponse, Utterance } from '@deepgram/sdk/dist/types';
import type { Show } from '@prisma/client';
import { detectSpeakerNames, getSlimUtterances } from './utils';

interface FrontMatterGuest {
	name: string;
	twitter: string;
	url: string;
	social: string[];
}

const transcripts_path = path.join(process.cwd(), 'src/assets/transcripts-flagged');

export async function save_transcript_to_db(show: Show, utterances: Utterance[]) {
	// Create Slim Utterances for Speaker Detection
	const slim_utterances = getSlimUtterances(utterances, show.number);
	// Detect Speakers
	const speakerMap = detectSpeakerNames(slim_utterances);
	const who = speakerMap.get(0);

	// Create Utterances
	const create_utterances = utterances.map((utterance) => {
		const words = utterance.words?.map((word) => {
			return {
				start: word.start,
				end: word.end,
				punctuated_word: word.punctuated_word || word.word,
				word: word.word,
				speaker_confidence: word.confidence,
				speaker: word.speaker || 99,
				confidence: word.confidence
			};
		});
		return {
			start: utterance.start,
			end: utterance.end,
			transcript_value: utterance.transcript,
			channel: utterance.channel,
			confidence: utterance.confidence,
			speaker: utterance.speaker || 99,
			speakerName: speakerMap.get(utterance.speaker || 99),
			words: {
				create: words
			}
		};
	});

	const start = Date.now();
	console.log(`About to Save to the DB`);

	// 1. Create the Transcript Record
	const transcript = await prisma.transcript.create({
		data: {
			show_number: show.number
		}
	});
	// console.log(`Created Transcript Record: ${transcript.id}`);
	// 2. Create the Utterances
	for (const { words, ...utterance } of create_utterances) {
		const utteranceRecord = await prisma.transcriptUtterance.create({
			data: {
				...utterance,
				transcriptId: transcript.id // Associate the Utterance with the Transcript
			}
		});
		// console.log(`Created Utterance Record: ${utteranceRecord.id}`);
		// 3. Create the Words
		const wordIds = await prisma.transcriptUtteranceWord.createMany({
			data: words.create.map((word) => {
				return {
					...word,
					// Associate the Word with the Utterance
					transcriptUtteranceId: utteranceRecord.id
				};
			})
		});
		// console.log(`Created ${wordIds.count} Word Records for Utterance ${utteranceRecord.id}`);
	}

	return transcript;

	// // Loop over each utterance and create it
	// for (const utterance of create_utterances) {
	// 	console.log('Create Word REcords');
	// 	const wordIds = await prisma.transcriptUtteranceWord.createMany({
	// 		data: [
	//       { tra}
	//     ]
	// 	});
	// 	console.log('Word Ids: ', wordIds);
	// }

	// const create = prisma.transcript.create({
	// 	data: {
	// 		show_number: show.number,
	// 		utterances: {
	// 			create: create_utterances
	// 		}
	// 	}
	// });
}

// Import Transcripts from JSON file - used for the initial import
export async function import_transcripts() {
	try {
		const files = await fs.readdir(transcripts_path);
		// Filter only .md files
		const transcriptFiles = files.filter((file) => file.endsWith('.json'));
		// Loop over each one and import
		const transcript_promises = transcriptFiles.map(async (file) => {
			console.log(`Importing ${file}`);
			const transcript: PrerecordedTranscriptionResponse = JSON.parse(
				await readFile(path.join(transcripts_path, file), 'utf-8')
			);
			const show_number = parseInt(file.split(' - ')[0]);
			// Check if there is already a transcript for this show
			const existing_transcript = await prisma.transcript.findUnique({ where: { show_number } });
			if (existing_transcript) {
				// console.log('Transcript already exists, skipping');
				return;
			}
			// Find the show this transcript belongs to
			const show = await prisma.show.findUnique({ where: { number: show_number } });
			if (!show) {
				console.log('No associated show found');
				return;
			}
			if (!transcript.results?.utterances) {
				console.log('No utterances found');
				return;
			}
			// Save to utterances to DB
			console.log(
				`Saving ${transcript.results?.utterances.length} utterances to DB for show ${show.number}`
			);
			await save_transcript_to_db(show, transcript.results?.utterances);
		});
		const results = await Promise.allSettled(transcript_promises);
		const success = results.filter((promise) => promise.status === 'fulfilled');

		return {
			message: `Transcripts Import finished: ${success.length} out of ${transcript_promises.length} successfull`
		};
	} catch (err) {
		if (typeof err === 'string') throw error(500, err);
		if (err instanceof Error) {
			console.error('❌ Transcript Import Error:', err.message);
			throw error(500, `Error Importing Transcript: ${err.message}`);
		}
	}
}
