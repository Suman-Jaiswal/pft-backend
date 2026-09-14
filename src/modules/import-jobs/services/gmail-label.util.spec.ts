import { listDirectChildLabels, prepareGeminiBody, stripHtml } from './gmail-label.util'

describe('listDirectChildLabels', () => {
  const parent = 'CC Transactions'

  it('returns only direct children of the parent label', () => {
    const names = [
      'CC Transactions',
      'CC Transactions/SBI',
      'CC Transactions/HDFC',
      'CC Transactions/AUSFB',
      'CC Transactions/SBI/foo',
      'CC Statements/SBI',
      'INBOX',
    ]

    expect(listDirectChildLabels(names, parent)).toEqual([
      { name: 'CC Transactions/SBI', leaf: 'SBI' },
      { name: 'CC Transactions/HDFC', leaf: 'HDFC' },
      { name: 'CC Transactions/AUSFB', leaf: 'AUSFB' },
    ])
  })

  it('does not treat a grandchild or sibling tree as a child', () => {
    expect(
      listDirectChildLabels(['CC Transactions/SBI/foo', 'CC Statements/SBI'], parent),
    ).toEqual([])
  })

  it('returns empty when the parent itself is the only match', () => {
    expect(listDirectChildLabels(['CC Transactions'], parent)).toEqual([])
  })
})

describe('prepareGeminiBody', () => {
  it('strips HTML then caps length', () => {
    const raw = '<html><style>x{}</style><body>Hello <b>world</b></body></html>'
    expect(prepareGeminiBody(raw, 4000)).toBe('Hello world')
    expect(prepareGeminiBody('abcdefghij', 4)).toBe('abcd')
  })

  it('strips script/style then applies the cap', () => {
    const raw = '<script>secret()</script><p>abcdef</p>'
    expect(stripHtml(raw)).toBe('abcdef')
    expect(prepareGeminiBody(raw, 3)).toBe('abc')
  })
})
