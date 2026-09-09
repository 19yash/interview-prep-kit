import { describe, expect, it } from 'vitest'
import { assertFetchableUrl, FetchGuardError, isPrivateHostname } from '../src/fetch/url-guard.js'

describe('isPrivateHostname', () => {
  it('flags loopback names and addresses', () => {
    expect(isPrivateHostname('localhost')).toBe(true)
    expect(isPrivateHostname('127.0.0.1')).toBe(true)
    expect(isPrivateHostname('127.1.2.3')).toBe(true)
    expect(isPrivateHostname('::1')).toBe(true)
    expect(isPrivateHostname('[::1]')).toBe(true)
  })

  it('flags the RFC1918 ranges', () => {
    expect(isPrivateHostname('10.0.0.5')).toBe(true)
    expect(isPrivateHostname('172.16.4.9')).toBe(true)
    expect(isPrivateHostname('172.31.255.255')).toBe(true)
    expect(isPrivateHostname('192.168.1.1')).toBe(true)
  })

  it('does not flag 172.32.x, which sits outside the private block', () => {
    expect(isPrivateHostname('172.32.0.1')).toBe(false)
  })

  it('flags link-local, carrier-grade NAT and metadata addresses', () => {
    expect(isPrivateHostname('169.254.169.254')).toBe(true)
    expect(isPrivateHostname('100.64.0.1')).toBe(true)
    expect(isPrivateHostname('0.0.0.0')).toBe(true)
  })

  it('flags internal suffixes', () => {
    expect(isPrivateHostname('db.internal')).toBe(true)
    expect(isPrivateHostname('printer.local')).toBe(true)
  })

  it('does not flag ordinary public hostnames', () => {
    expect(isPrivateHostname('gitlab.com')).toBe(false)
    expect(isPrivateHostname('acme.co.uk')).toBe(false)
  })
})

describe('assertFetchableUrl', () => {
  it('returns a URL for an ordinary https address', () => {
    expect(assertFetchableUrl('https://gitlab.com/handbook').href).toBe('https://gitlab.com/handbook')
  })

  it('accepts a bare hostname by assuming https', () => {
    expect(assertFetchableUrl('gitlab.com').href).toBe('https://gitlab.com/')
  })

  it('rejects a non-http scheme', () => {
    expect(() => assertFetchableUrl('file:///etc/passwd')).toThrow(FetchGuardError)
    expect(() => assertFetchableUrl('javascript:alert(1)')).toThrow(FetchGuardError)
  })

  it('rejects unparseable input', () => {
    expect(() => assertFetchableUrl('   ')).toThrow(FetchGuardError)
  })

  it('rejects a private address by default', () => {
    try {
      assertFetchableUrl('http://localhost:8099/acme/')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(FetchGuardError)
      expect((error as FetchGuardError).code).toBe('PRIVATE_ADDRESS')
    }
  })

  it('allows a private address when explicitly permitted, which the batch command needs', () => {
    const url = assertFetchableUrl('http://localhost:8099/acme/', { allowPrivate: true })
    expect(url.hostname).toBe('localhost')
    expect(url.port).toBe('8099')
  })
})
