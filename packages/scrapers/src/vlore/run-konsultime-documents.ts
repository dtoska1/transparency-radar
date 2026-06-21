import { VloreKonsultimeDocumentEnricher } from './konsultime-documents.js';

const enricher = new VloreKonsultimeDocumentEnricher();

try {
  await enricher.run();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
