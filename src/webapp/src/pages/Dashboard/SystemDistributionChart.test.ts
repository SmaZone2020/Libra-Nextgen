import { describe, expect, it } from 'vitest';
import { classifyOs } from './SystemDistributionChart';

describe('classifyOs', () => {
  it('classifies Windows by major version', () => {
    expect(classifyOs('Windows 11 Pro 23H2')).toBe('Windows 11');
    expect(classifyOs('Windows 10 Pro 22H2')).toBe('Windows 10');
    expect(classifyOs('Windows 7 Ultimate')).toBe('Windows 7');
  });

  it('classifies Windows 11 when ProductName still says Windows 10 (NT >= 10.0.22000)', () => {
    expect(classifyOs('Windows 10 Pro 10.0.22631')).toBe('Windows 11');
    expect(classifyOs('Windows 10 Enterprise 10.0.22000')).toBe('Windows 11');
  });

  it('falls back to Windows 10 for NT 10.0 builds below 22000', () => {
    expect(classifyOs('Windows 10 Pro 10.0.19045')).toBe('Windows 10');
  });

  it('classifies NT version strings without product names', () => {
    expect(classifyOs('Windows NT 6.1')).toBe('Windows 7');
    expect(classifyOs('Windows NT 10.0')).toBe('Windows 10');
  });

  it('buckets unknown Windows versions', () => {
    expect(classifyOs('Windows 8.1')).toBe('Windows (其他)');
    expect(classifyOs('Windows XP')).toBe('Windows (其他)');
  });

  it('classifies common Linux distros from PRETTY_NAME', () => {
    expect(classifyOs('Ubuntu 22.04.3 LTS')).toBe('Ubuntu');
    expect(classifyOs('Debian GNU/Linux 12 (bookworm)')).toBe('Debian');
    expect(classifyOs('Kali GNU/Linux 2024.2')).toBe('Kali');
    expect(classifyOs('CentOS Linux 7 (Core)')).toBe('CentOS');
    expect(classifyOs('Fedora Linux 40')).toBe('Fedora');
    expect(classifyOs('Rocky Linux 9.4')).toBe('Rocky Linux');
    expect(classifyOs('AlmaLinux 9.3')).toBe('AlmaLinux');
    expect(classifyOs('Arch Linux')).toBe('Arch');
    expect(classifyOs('Linux Mint 21.3')).toBe('Linux Mint');
    expect(classifyOs('openSUSE Leap 15.5')).toBe('openSUSE');
    expect(classifyOs('Alpine Linux v3.19')).toBe('Alpine');
    expect(classifyOs('Manjaro Linux')).toBe('Manjaro');
    expect(classifyOs('Pop!_OS 22.04 LTS')).toBe('Pop!_OS');
    expect(classifyOs('Red Hat Enterprise Linux 9')).toBe('RHEL');
  });

  it('buckets unknown Linux kernels', () => {
    expect(classifyOs('Linux 6.2.0-36-generic')).toBe('Linux (其他)');
  });

  it('classifies macOS and Android', () => {
    expect(classifyOs('macOS 14.5')).toBe('macOS');
    expect(classifyOs('Darwin 23.5.0')).toBe('macOS');
    expect(classifyOs('Android 14')).toBe('Android');
  });

  it('handles empty and unknown values', () => {
    expect(classifyOs('')).toBe('未知');
    expect(classifyOs('custom-os-42')).toBe('其他');
  });
});
