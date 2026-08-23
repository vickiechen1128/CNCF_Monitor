import { cleanup } from '@testing-library/react';
import { vi, type Mock, beforeEach, afterEach } from 'vitest';
import { Modal } from 'antd';
import type { ModalFuncProps } from 'antd/es/modal/interface';

/**
 * Ant Design 组件在 jsdom 环境下的测试稳定模式。
 *
 * 用法：在涉及 antd 组件的测试文件顶部调用 setupAntdTest()，
 * 需要 mock Modal 静态方法时再调用 mockAntdModal()。
 *
 * @example
 * import { render, screen } from '@testing-library/react';
 * import userEvent from '@testing-library/user-event';
 * import { setupAntdTest, mockAntdModal } from '@/test/antdTestUtils';
 *
 * describe('MyPage', () => {
 *   setupAntdTest();
 *
 *   it('deletes item after confirm', async () => {
 *     const modal = mockAntdModal();
 *     render(<MyPage />);
 *
 *     await userEvent.click(screen.getByRole('button', { name: '删除' }));
 *     expect(modal.confirm).toHaveBeenCalled();
 *
 *     const onOk = modal.confirm.mock.calls[0][0].onOk;
 *     await onOk?.();
 *   });
 * });
 */

export function setupAntdTest(): void {
  beforeEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );

    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({
        getPropertyValue: vi.fn(() => ''),
      })) as unknown as typeof window.getComputedStyle
    );

    vi.stubGlobal('scrollTo', vi.fn());

    vi.stubGlobal(
      'ResizeObserver',
      vi.fn(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
      }))
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}

export interface MockedModal {
  confirm: Mock;
  info: Mock;
  success: Mock;
  error: Mock;
  warning: Mock;
}

/**
 * 统一 mock antd Modal 的静态方法（confirm / info / success / error / warning）。
 * 避免跨用例的 portal DOM 残留和 spy 未 restore 导致的 flaky。
 */
export function mockAntdModal(): MockedModal {
  const noopDestroy = () => {};
  type ModalConfigUpdate = ModalFuncProps | ((prevConfig: ModalFuncProps) => ModalFuncProps);

  const createMockImpl =
    (mockFn: Mock) =>
    (props: ModalFuncProps): { destroy: () => void; update: (configUpdate: ModalConfigUpdate) => void } => {
      mockFn(props);
      return {
        destroy: noopDestroy,
        update: vi.fn(),
      };
    };

  const modal: MockedModal = {
    confirm: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  };

  vi.spyOn(Modal, 'confirm').mockImplementation(createMockImpl(modal.confirm));
  vi.spyOn(Modal, 'info').mockImplementation(createMockImpl(modal.info));
  vi.spyOn(Modal, 'success').mockImplementation(createMockImpl(modal.success));
  vi.spyOn(Modal, 'error').mockImplementation(createMockImpl(modal.error));
  vi.spyOn(Modal, 'warning').mockImplementation(createMockImpl(modal.warning));

  return modal;
}

/**
 * 在已打开的 antd Select 中选择指定文本的选项。
 * 需要先点击 Select 打开下拉面板，再调用本函数。
 */
export async function selectAntdOption(
  optionText: string,
  container: HTMLElement = document.body
): Promise<void> {
  const { findByText } = await import('@testing-library/react');
  const option = await findByText(container, optionText);
  const { default: userEvent } = await import('@testing-library/user-event');
  await userEvent.click(option);
}
