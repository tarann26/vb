import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TemplateContentForm from '../TemplateContentForm';
import type { TemplateSection } from '../../content/types';

function renderForm(section: TemplateSection, overrides: Partial<Parameters<typeof TemplateContentForm>[0]> = {}) {
  const onChange = vi.fn();
  const stage = vi.fn();
  render(
    <TemplateContentForm
      section={section}
      onChange={onChange}
      rowPrefix="[7]"
      problems={[]}
      idPrefix="section-7"
      stage={stage}
      {...overrides}
    />,
  );
  return { onChange, stage };
}

describe('TemplateContentForm: one branch per template, each renders its own real fields', () => {
  it('text: heading + paragraphs', () => {
    renderForm({ kind: 'template', id: 'x', enabled: true, template: 'text', content: { heading: 'H', paragraphs: ['p1', 'p2'] } });
    expect(screen.getByLabelText('Heading')).toHaveValue('H');
    expect(screen.getByLabelText('Paragraph 1')).toHaveValue('p1');
    expect(screen.getByLabelText('Paragraph 2')).toHaveValue('p2');
  });

  it('itemList: heading + items, each with name/description/photo', () => {
    renderForm({
      kind: 'template',
      id: 'x',
      enabled: true,
      template: 'itemList',
      content: { heading: 'H', items: [{ image: '/a.webp', name: 'Focaccia', description: 'd' }] },
    });
    expect(screen.getByLabelText('Heading')).toHaveValue('H');
    expect(screen.getByLabelText('Name')).toHaveValue('Focaccia');
    expect(screen.getByLabelText('Description')).toHaveValue('d');
  });

  it('gallery: heading + layout select + images', () => {
    renderForm({
      kind: 'template',
      id: 'x',
      enabled: true,
      template: 'gallery',
      content: { heading: 'H', layout: 'grid', images: [{ src: '/a.webp', alt: 'A' }] },
    });
    expect(screen.getByLabelText('Layout')).toHaveValue('grid');
    expect(screen.getByLabelText('Alt text')).toHaveValue('A');
  });

  it('detailBlock: heading + body + facts', () => {
    renderForm({
      kind: 'template',
      id: 'x',
      enabled: true,
      template: 'detailBlock',
      content: { heading: 'H', body: 'B', facts: [{ label: 'Day', value: 'Sat' }] },
    });
    expect(screen.getByLabelText('Body')).toHaveValue('B');
    expect(screen.getByLabelText('Label')).toHaveValue('Day');
    expect(screen.getByLabelText('Value')).toHaveValue('Sat');
  });
});

describe('TemplateContentForm: paragraph list add/remove/reorder (text template)', () => {
  function section(paragraphs: string[]): TemplateSection {
    return { kind: 'template', id: 'x', enabled: true, template: 'text', content: { heading: 'H', paragraphs } };
  }

  it('"Add a paragraph" appends a blank paragraph', async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm(section(['p1']));
    await user.click(screen.getByRole('button', { name: 'Add a paragraph' }));
    expect(onChange).toHaveBeenCalledWith({ ...section(['p1']), content: { heading: 'H', paragraphs: ['p1', ''] } });
  });

  it('"Remove paragraph 1" drops exactly that paragraph', async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm(section(['p1', 'p2']));
    await user.click(screen.getByRole('button', { name: 'Remove paragraph 1' }));
    expect(onChange).toHaveBeenCalledWith({ ...section(['p1', 'p2']), content: { heading: 'H', paragraphs: ['p2'] } });
  });

  it('"Move paragraph 2 up" swaps it with paragraph 1', async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm(section(['p1', 'p2']));
    await user.click(screen.getByRole('button', { name: 'Move paragraph 2 up' }));
    expect(onChange).toHaveBeenCalledWith({ ...section(['p1', 'p2']), content: { heading: 'H', paragraphs: ['p2', 'p1'] } });
  });
});

describe('TemplateContentForm: the optional WhatsApp button', () => {
  const base: TemplateSection = { kind: 'template', id: 'x', enabled: true, template: 'text', content: { heading: 'H', paragraphs: ['p'] } };

  it('starts unchecked and hidden when the section has no whatsapp button', () => {
    renderForm(base);
    expect(screen.getByLabelText('Include a WhatsApp button')).not.toBeChecked();
    expect(screen.queryByLabelText('Button label')).not.toBeInTheDocument();
  });

  it('checking the box reveals label/message fields and sets a blank button', async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm(base);
    await user.click(screen.getByLabelText('Include a WhatsApp button'));
    expect(onChange).toHaveBeenCalledWith({ ...base, content: { ...base.content, whatsapp: { label: '', message: '' } } });
  });

  it('unchecking an existing button removes it entirely (undefined, not blank)', async () => {
    const user = userEvent.setup();
    const withButton: TemplateSection = { ...base, content: { ...base.content, whatsapp: { label: 'L', message: 'M' } } };
    const { onChange } = renderForm(withButton);
    expect(screen.getByLabelText('Include a WhatsApp button')).toBeChecked();
    await user.click(screen.getByLabelText('Include a WhatsApp button'));
    const [result] = onChange.mock.calls[0];
    expect(result.content).not.toHaveProperty('whatsapp');
  });
});

describe('TemplateContentForm: problems are addressed to the right field', () => {
  it('a heading problem shows under the Heading field', () => {
    const section: TemplateSection = { kind: 'template', id: 'x', enabled: true, template: 'text', content: { heading: '', paragraphs: [''] } };
    render(
      <TemplateContentForm
        section={section}
        onChange={vi.fn()}
        rowPrefix="[7]"
        problems={[{ field: '[7].content.heading', message: 'this section needs a heading' }]}
        idPrefix="section-7"
        stage={vi.fn()}
      />,
    );
    expect(screen.getByText('this section needs a heading')).toBeInTheDocument();
  });
});
