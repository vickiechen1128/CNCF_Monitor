import { cleanup } from '@testing-library/react';
import { vi, type Mock, beforeEach, afterEach } from 'vitest';
import { App, Modal, message } from 'antd';
import type { ModalFuncProps } from 'antd/es/modal/interface';
import type { MessageType } from 'antd/es/message/interface';

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

  // 页面已迁移到 App.useApp().modal.confirm（消费 App 上下文，不经静态 Modal.confirm）：
  // 一并 mock App.useApp，使 modal.confirm 命中同一 spy，覆盖 AlertConfigPage / NotifyTemplatesPage 等。
  // 仅替换 modal 为 spy，保留真实的 message / notification（否则 message.error 等不再渲染到 DOM，破坏文案断言）。
  const realUseApp = App.useApp;
  vi.spyOn(App, 'useApp').mockImplementation(() => {
    const real = realUseApp();
    return { ...real, modal };
  });

  return modal;
}

export interface MockedMessage {
  success: Mock;
  error: Mock;
  warning: Mock;
  info: Mock;
  loading: Mock;
}

/**
 * 静默 antd 静态 message，避免测试输出噪音与 act 告警。
 *
 * antd 的 `message.*` 返回 `MessageType`（可调用的 `PromiseLike<boolean>`），
 * 因此 noop 实现必须返回**真实的 MessageType 形状**，不能返回 `undefined`
 * （否则与 antd 声明的 `TypeOpen` 不兼容，测试文件会报 TS2322 / TS2345）。
 *
 * 返回可断言的 mock 集合，供 `expect(message.success).toHaveBeenCalledWith(...)` 使用。
 */
export function mockAntdMessage(): MockedMessage {
  const noopMessageType: MessageType = Object.assign(() => {}, {
    then: () => noopMessageType,
  }) as unknown as MessageType;
  const open = () => noopMessageType;

  const mocked: MockedMessage = {
    success: vi.fn(open),
    error: vi.fn(open),
    warning: vi.fn(open),
    info: vi.fn(open),
    loading: vi.fn(open),
  };

  vi.spyOn(message, 'success').mockImplementation(mocked.success);
  vi.spyOn(message, 'error').mockImplementation(mocked.error);
  vi.spyOn(message, 'warning').mockImplementation(mocked.warning);
  vi.spyOn(message, 'info').mockImplementation(mocked.info);
  vi.spyOn(message, 'loading').mockImplementation(mocked.loading);

  return mocked;
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
