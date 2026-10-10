#!/usr/bin/env python3
"""Create original QA pages, silence, and a recipe. Never use as study material."""
import argparse
import json
from pathlib import Path
import wave

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas


def create(directory: Path):
    directory.mkdir()  # New directory only: never overwrite a user's material.
    pdf = directory / 'synthetic-pages.pdf'
    canvas = Canvas(str(pdf), pagesize=A4, invariant=True, pageCompression=1)
    width, height = A4
    canvas.setTitle('Original synthetic QA pages - NOT a TOEIC practice paper')
    canvas.setAuthor('LANTERN automated test fixture')

    def header(page, title):
        canvas.setFillColor(colors.HexColor('#14394b'))
        canvas.rect(0, height - 78, width, 78, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont('Helvetica-Bold', 18)
        canvas.drawString(32, height - 34, title)
        canvas.setFont('Helvetica', 10)
        canvas.drawString(32, height - 57, 'SYNTHETIC QA ONLY - no official or usable practice questions')
        canvas.setFont('Helvetica', 7)
        canvas.drawString(4, height - 10, f'P{page} TL')
        canvas.drawRightString(width - 4, height - 10, f'P{page} TR')
        canvas.setFillColor(colors.HexColor('#182b37'))
        canvas.drawString(4, 7, f'P{page} BL')
        canvas.drawRightString(width - 4, 7, f'P{page} BR')
        canvas.setFont('Helvetica', 9)
        canvas.drawString(32, 24, f'Original QA fixture | PDF page {page} | preserve this footer')

    def box(x, y, w, h, title, lines):
        canvas.setFillColor(colors.HexColor('#eef4f6'))
        canvas.roundRect(x, y, w, h, 5, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor('#182b37'))
        canvas.setFont('Helvetica-Bold', 11)
        canvas.drawString(x + 10, y + h - 22, title)
        canvas.setFont('Helvetica', 9)
        for index, line in enumerate(lines):
            canvas.drawString(x + 10, y + h - 39 - 13 * index, line)

    header(1, 'Listening - Part 1 image markers')
    for index in range(6):
        x, y = 32 + (index % 2) * 266, height - 290 - (index // 2) * 220
        box(x, y, 246, 194, f'Question {index + 1} - QA drawing', ['A geometric control image, not a real question.'])
        canvas.setStrokeColor(colors.HexColor('#38738b'))
        canvas.setLineWidth(3)
        canvas.circle(x + 73, y + 73, 32)
        canvas.rect(x + 130, y + 42, 54, 62)
        canvas.line(x + 25, y + 23, x + 221, y + 23)
    canvas.showPage()

    header(2, 'Listening - Parts 3 and 4 markers')
    canvas.setFont('Helvetica', 11)
    canvas.drawString(32, height - 105, 'These are page/number controls. There is no exam conversation.')
    for index, number in enumerate(range(32, 101)):
        col, row = index % 3, index // 3
        canvas.drawString(32 + 177 * col, height - 140 - row * 26, f'{number}. QA A / B / C / D')
    canvas.showPage()

    header(3, 'Reading - Part 5 answer-card markers')
    for index, number in enumerate(range(101, 131)):
        col, row = index // 15, index % 15
        x, y = 32 + col * 266, height - 118 - row * 44
        canvas.setFont('Helvetica-Bold', 10)
        canvas.drawString(x, y, f'{number}. ORIGINAL QA TEXT ONLY')
        canvas.setFont('Helvetica', 9)
        canvas.drawString(x, y - 15, 'A control   B sample   C marker   D fixture')
    canvas.showPage()

    header(4, 'Reading - Part 6 group markers')
    for index in range(4):
        start = 131 + index * 4
        box(32, height - 258 - index * 171, width - 64, 153,
            f'Questions {start}-{start + 3}: one synthetic document',
            ['This paragraph exists only to check source-page preservation.',
             'No sentence is a real test item. No answer is printed on this page.',
             'Readability markers: reservation, accommodation, international.',
             'Select answers only on the application answer card.'])
    canvas.showPage()

    header(5, 'Reading - Part 7 single-document groups')
    starts = list(range(147, 174, 3)) + [174]
    for index, start in enumerate(starts):
        count = 2 if start == 174 else 3
        col, row = index % 2, index // 2
        box(32 + col * 266, height - 224 - row * 136, 246, 120,
            f'Questions {start}-{start + count - 1}',
            ['One synthetic source document.', 'Preserve the page and its number markers.',
             'This is not a reading practice passage.'])
    canvas.showPage()

    header(6, 'Reading - Part 7 multiple documents')
    for index, start in enumerate(range(176, 201, 5)):
        count = 2 if index < 2 else 3
        box(32, height - 231 - index * 139, width - 64, 123,
            f'Questions {start}-{start + 4}: {count} synthetic documents',
            [f'Document {part}: independent QA text marker.' for part in range(1, count + 1)] +
            ['Do not treat this fixture as an official or original practice test.'])
    canvas.showPage()

    header(7, 'Reading - continuation of one document')
    box(32, height - 285, width - 64, 180, 'Questions 147-149: same source, second page',
        ['This is a continuation of the FIRST document on PDF page 5.',
         'One passage may span two PDF pages; image count is not passage count.',
         'The marker below checks small print at full image resolution.'])
    for index, size in enumerate([8, 10, 12]):
        canvas.setFont('Helvetica', size)
        canvas.drawString(32, height - 340 - index * 30,
                          f'{size} pt: reservation accommodation international correspondence')
    canvas.showPage()

    header(8, 'EXCLUDED - answer appendix control')
    canvas.setFont('Helvetica-Bold', 15)
    canvas.drawString(32, height - 115, 'THIS PAGE MUST NEVER BE A QUESTION IMAGE')
    canvas.setFont('Helvetica', 11)
    canvas.drawString(32, height - 143, 'Excluded by explicit PDF page mapping. No OCR inference is used.')
    canvas.save()

    with wave.open(str(directory / 'synthetic-silence.wav'), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(8000)
        stream.writeframes(b'\x00\x00' * 8000 * 20)

    groups, answers = [], []
    number = 1

    def add(part, size, passages=0):
        nonlocal number
        ns = list(range(number, number + size))
        page = 1 if part == 1 else 2 if part in (3, 4) else 3 if part == 5 else 4 if part == 6 else 5 if number < 176 else 6
        groups.append({'id': f'qa-{number}', 'part': part, 'questionNumbers': ns,
                       'passageCount': passages,
                       'pages': [] if part == 2 else [{'documentId': 'source', 'page': page}] +
                       ([{'documentId': 'source', 'page': 7}] if number == 147 else [])})
        answers.extend('ABCD'[n % (3 if part == 2 else 4)] for n in ns)
        number += size

    for part, times, size, passages in [(1, 6, 1, 0), (2, 25, 1, 0), (3, 13, 3, 0),
                                        (4, 10, 3, 0), (5, 30, 1, 0), (6, 4, 4, 1)]:
        for _ in range(times):
            add(part, size, passages)
    for _ in range(9):
        add(7, 3, 1)
    add(7, 2, 1)
    for index in range(5):
        add(7, 5, 2 if index < 2 else 3)
    assert number == 201 and len(answers) == 200
    recipe = {'kind': 'lantern-exam-page-recipe', 'schemaVersion': 1,
              'exam': {'id': 'page-packer-qa-only', 'version': 1,
                       'title': 'PDF page packing QA ONLY - 非真题',
                       'source': {'classification': 'original', 'title': 'Original synthetic PDF QA fixture',
                                  'rightsStatement': 'Original QA controls only. Not study material or official questions.'}},
              'documents': [{'id': 'source', 'file': pdf.name}],
              'audioFile': 'synthetic-silence.wav', 'audioReviewed': True,
              'pageReview': {'reviewed': True, 'excludedPages': [{'documentId': 'source', 'page': 8}]},
              'answers': answers, 'groups': groups}
    (directory / 'recipe.json').write_text(json.dumps(recipe, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'created': True, 'pdfPages': 8, 'referencedPages': 7, 'questions': 200,
                      'syntheticOnly': True, 'audio': '20-second silence, not listening content'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out-dir', required=True, type=Path)
    create(parser.parse_args().out_dir)
