import { PogradecKonsultimeDocumentEnricher } from './konsultime-documents.js';

const enricher = new PogradecKonsultimeDocumentEnricher();

try {
  await enricher.run();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
