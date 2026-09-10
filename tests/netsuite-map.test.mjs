// @ts-check
/**
 * Status and priority ids here are the real ones, read out of a live account
 * with `SELECT DISTINCT status, BUILTIN.DF(status) FROM supportcase`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { accountHost, caseUrl, mapPriority, mapStatus, normalizeCase } from '../dist/adapters/netsuite-map.js';

describe('mapStatus', () => {
  it('maps the account\'s real status ids onto the shared buckets', () => {
    assert.equal(mapStatus('1'), 'open'); // Not Started
    assert.equal(mapStatus('2'), 'in_progress'); // In Progress
    assert.equal(mapStatus('5'), 'closed'); // Closed
    assert.equal(mapStatus('6'), 'waiting'); // Waiting for Customer Response
    assert.equal(mapStatus('7'), 'waiting'); // On Hold
    assert.equal(mapStatus('8'), 'waiting'); // Waiting on NetSuite
    assert.equal(mapStatus('9'), 'open'); // Scheduled
    assert.equal(mapStatus('10'), 'waiting'); // Submitted to Development
    assert.equal(mapStatus('11'), 'open'); // Follow Up Required
    assert.equal(mapStatus('12'), 'in_progress'); // Ongoing Project
  });

  it('treats an unknown custom status as open, never as closed', () => {
    // Guessing "closed" would silently drop real work off the list and out of
    // the badge count; guessing "open" merely shows something extra.
    assert.equal(mapStatus('99'), 'open');
    assert.equal(mapStatus('custom_thing'), 'open');
  });

  it('survives a missing status', () => {
    assert.equal(mapStatus(undefined), 'open');
    assert.equal(mapStatus(null), 'open');
    assert.equal(mapStatus(''), 'open');
  });
});

describe('mapPriority', () => {
  it('maps NetSuite priority ids', () => {
    assert.equal(mapPriority('1'), 'high');
    assert.equal(mapPriority('2'), 'medium');
    assert.equal(mapPriority('3'), 'low');
  });

  it('returns null rather than inventing a priority', () => {
    assert.equal(mapPriority(undefined), null);
    assert.equal(mapPriority(null), null);
    assert.equal(mapPriority('7'), null);
  });
});

describe('accountHost', () => {
  it('builds the UI and API hosts for a production account', () => {
    assert.equal(accountHost('6967599', 'app'), '6967599.app.netsuite.com');
    assert.equal(accountHost('6967599', 'api'), '6967599.suitetalk.api.netsuite.com');
  });

  it('converts a sandbox underscore to the hyphen the hostname needs', () => {
    assert.equal(accountHost('1234567_SB1', 'app'), '1234567-sb1.app.netsuite.com');
    assert.equal(accountHost('1234567_SB1', 'api'), '1234567-sb1.suitetalk.api.netsuite.com');
  });

  it('tolerates stray whitespace and case from a text input', () => {
    assert.equal(accountHost('  6967599  ', 'api'), '6967599.suitetalk.api.netsuite.com');
    assert.equal(accountHost('1234567_SB1'.toUpperCase(), 'app'), '1234567-sb1.app.netsuite.com');
  });
});

describe('caseUrl', () => {
  it('deep links to the case record', () => {
    assert.equal(
      caseUrl('6967599', '100162'),
      'https://6967599.app.netsuite.com/app/crm/support/supportcase.nl?id=100162',
    );
  });
});

describe('normalizeCase', () => {
  it('maps a real-shaped SuiteQL row onto the shared shape', () => {
    const task = normalizeCase(
      {
        id: '100162',
        casenumber: '14173',
        title: 'Invoice printing wrong subsidiary',
        status: '2',
        priority: '2',
        assigned: '431775',
      },
      '6967599',
    );

    assert.equal(task.id, 'netsuite:100162');
    assert.equal(task.sourceId, '100162');
    assert.equal(task.title, 'Invoice printing wrong subsidiary');
    assert.equal(task.status, 'in_progress');
    assert.equal(task.priority, 'medium');
    assert.equal(task.subtitle, 'Case 14173');
    assert.equal(task.source, 'netsuite');
    assert.equal(task.url, 'https://6967599.app.netsuite.com/app/crm/support/supportcase.nl?id=100162');
  });

  it('leaves dueDate null — support cases have no due-date field', () => {
    // `enddate` is the closed date, not a target. It is empty on every open
    // case, so using it as a deadline would invent urgency that doesn't exist.
    const task = normalizeCase({ id: '1', status: '2', enddate: '' }, '6967599');
    assert.equal(task.dueDate, null);
  });

  it('handles NetSuite omitting null columns from the row entirely', () => {
    // NetSuite doesn't send `"lastmessagedate": null` — the key is simply absent.
    const task = normalizeCase({ id: '4010', casenumber: '13471', status: '7' }, '6967599');

    assert.equal(task.status, 'waiting');
    assert.equal(task.priority, null);
    assert.equal(task.title, '(untitled case)');
    assert.equal(task.subtitle, 'Case 13471');
  });

  it('keeps the untouched row on raw for debugging', () => {
    const row = { id: '1', casenumber: '99', status: '1' };
    assert.deepEqual(normalizeCase(row, '6967599').raw, row);
  });
});
