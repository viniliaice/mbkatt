import { describe, expect, it } from 'vitest';
import { classifyMessage, emptyClassifierContext, extractMentions, detectEvents } from '../src/lib/classify';

const context = emptyClassifierContext();
context.staffNames.add('ikram axmed');
context.staffTokens.add('ikram');
context.staffNames.add('ahmed jaamac ism');
context.staffTokens.add('nafiisa');
context.staffTokens.add('xuseen');

const classify = (text: string) => classifyMessage(text, context);

describe('event detection', () => {
  it('recognises the event types from the specification', () => {
    const cases: [string, string][] = [
      ["I'll be in late", 'LATE'],
      ['Ikram will be late', 'LATE'],
      ['Teacher Nuha will be absent today', 'ABSENT'],
      ['Teacher ikram is also sick and not coming in', 'SICK'],
      ['T. Nuha left early', 'LEFT_EARLY'],
      ['Teacher Xuseen is late', 'LATE'],
      ['Teacher Huda Saeed is in hospital', 'HOSPITAL'],
      ['Teacher Faysal has gone to a funeral', 'FUNERAL'],
      ['T. Axmed jaamc 5min late', 'LATE'],
      ['Teacher Xuseen is on the way', 'ON_THE_WAY'],
      ['T. Nuha is going home', 'GOING_HOME'],
      ['Teacher Maryan had an emergency at home', 'EMERGENCY'],
      ['I need a day off for a personal matter', 'PERSONAL'],
    ];
    for (const [text, expected] of cases) {
      const events = detectEvents(text).map((event) => event.type);
      expect(events, text).toContain(expected);
    }
  });

  it('keeps the original wording of the matched phrase', () => {
    const events = detectEvents("Ikram will be LATE today");
    expect(events[0].phrase.toLowerCase()).toBe('late');
  });

  it('detects combined sick + absent messages', () => {
    const events = detectEvents('Teacher ikram is also sick and not coming in');
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['SICK', 'ABSENT']),
    );
  });

  it('does not treat "on the way" as an absence', () => {
    const events = detectEvents('Teacher Xuseen is on the way');
    expect(events.map((event) => event.type)).not.toContain('ABSENT');
  });

  it('does not treat "will be back" or "went out" as an absence', () => {
    expect(detectEvents('Teacher Nimco will be back after the meeting').map((e) => e.type)).not.toContain(
      'ABSENT',
    );
    expect(detectEvents('T. Cumar went out to the bank').map((e) => e.type)).not.toContain('ABSENT');
  });

  it('does not report a negated event', () => {
    expect(detectEvents('Teacher Ikram is not late today')).toEqual([]);
    expect(detectEvents('She is not sick')).toEqual([]);
  });
});

describe('staff / student classification', () => {
  it('classifies bus and grade messages as student', () => {
    expect(classify('Bus 2 is late today, grade 5 students are waiting').audience).toBe('student');
    expect(classify('G6 bus is late, students are at the gate').audience).toBe('student');
    expect(classify('Grade 3 has no teacher yet, T. Nafiisa is coming').audience).toBe('student');
    expect(classify('the van will arrive 7:45').audience).toBe('student');
  });

  it('classifies staff notifications as staff', () => {
    expect(classify("I'll be in late").audience).toBe('staff');
    expect(classify('Ikram will be late').audience).toBe('staff');
    expect(classify('T nafiisa is sick').audience).toBe('staff');
    expect(classify('Teacher Huda Saeed is in hospital').audience).toBe('staff');
  });

  it('flags undecidable messages as uncertain instead of dropping them', () => {
    const result = classify('Good morning everyone, let us prepare for the meeting');
    expect(result.audience).toBe('uncertain');
    expect(result.audienceConfidence).toBeLessThan(0.5);
    expect(result.audienceReasons.length).toBeGreaterThan(0);
  });

  it('records the reason for the classification', () => {
    const result = classify('Bus 4 left the station');
    expect(result.audienceReasons.join(' ')).toMatch(/student/i);
    expect(result.busInfo.length).toBeGreaterThan(0);
  });

  it('detects students and grades for information purposes', () => {
    expect(classify('G4 and G5 students will have the exam today').studentInfo.length).toBeGreaterThan(0);
    expect(classify('Bus 3 is on the way, 5 students inside').busInfo.length).toBeGreaterThan(0);
  });
});

describe('mention extraction', () => {
  it('extracts a titled name', () => {
    const { mentions } = extractMentions('T. Axmed jaamc 5min late', null, context);
    expect(mentions.map((mention) => mention.text)).toContain('Axmed jaamc');
  });

  it('extracts a full titled name without swallowing the verb', () => {
    const { mentions } = extractMentions('Teacher Axmed Jaamac will be late', null, context);
    expect(mentions.map((mention) => mention.text)).toContain('Axmed Jaamac');
  });

  it('extracts a name without a title when it is in the roster', () => {
    const { mentions } = extractMentions('Ikram will be late', null, context);
    expect(mentions.map((mention) => mention.text)).toContain('Ikram');
  });

  it('attributes first-person messages to the sender', () => {
    const { mentions, isFirstPerson } = extractMentions("I'll be in late", 'Fardosa Kamal', context);
    expect(isFirstPerson).toBe(true);
    expect(mentions[0].text).toBe('Fardosa Kamal');
    expect(mentions[0].isSelf).toBe(true);
  });
});
