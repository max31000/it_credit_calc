import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { NumericInput, type NumericInputProps } from '../NumericInput'

function renderInput(props: NumericInputProps) {
  return render(
    <MantineProvider>
      <NumericInput {...props} />
    </MantineProvider>,
  )
}

describe('NumericInput — приёмочные проверки §7.3 спеки', () => {
  it('Backspace в начале "1 000 000" не очищает поле и не прыгает наружу; blur клампит к min', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInput({ value: 1_000_000, onChange, min: 1_000_000, thousandSeparator: ' ' })

    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.click(input)
    input.setSelectionRange(0, 0)
    await user.keyboard('{Backspace}')

    // Наружу не ушло ни '', ни 0 — коммитятся только валидные значения в диапазоне
    expect(onChange).not.toHaveBeenCalledWith('')
    expect(onChange).not.toHaveBeenCalledWith(0)

    await user.tab() // blur
    expect(onChange).toHaveBeenLastCalledWith(1_000_000)
  })

  it('пустое поле с min=1000000: посимвольный набор 5000000 — каждый символ принимается, blur коммитит 5000000', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInput({ value: null, onChange, min: 1_000_000 })

    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.click(input)
    await user.type(input, '5000000')

    // Поле принимает ввод посимвольно, не сбрасывается на middle-typing
    expect(input.value.replace(/\s/g, '')).toBe('5000000')

    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(5_000_000)
  })

  it('сырой ввод с ведущими нулями ("000000") не уходит наружу, blur клампит к min', async () => {
    // Именно этот случай Mantine отдаёт в onChange строкой (§7.1 спеки) — то же самое
    // получается при удалении первого символа из "1 000 000".
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInput({ value: 1_000_000, onChange, min: 1_000_000, thousandSeparator: ' ' })

    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.tripleClick(input)
    await user.keyboard('000000')

    expect(input.value.replace(/\s/g, '')).toBe('000000') // поле показывает ввод, не очищается
    expect(onChange).not.toHaveBeenCalled() // наружу не ушло ни 0, ни ''

    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(1_000_000)
  })

  it('очистка обязательного поля: blur откатывает значение, возврат фокуса не показывает пустое', async () => {
    // Регрессия: откат черновика делался только при изменении value, поэтому после blur
    // поле выглядело верно, но при следующем фокусе снова становилось пустым.
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInput({ value: 1_000_000, onChange, min: 1_000_000, thousandSeparator: ' ' })

    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.click(input)
    await user.clear(input)
    await user.tab()

    expect(onChange).not.toHaveBeenCalled()
    expect(input.value.replace(/\s/g, '')).toBe('1000000')

    await user.click(input)
    expect(input.value.replace(/\s/g, '')).toBe('1000000')
  })

  it('allowEmpty: очистка поля и blur коммитят null', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInput({ value: 100, onChange, allowEmpty: true })

    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.click(input)
    await user.clear(input)
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('decimalScale для ставок: дробное значение коммитится, промежуточное "6." наружу не уходит', async () => {
    // Поля ставок (MortgageForm — decimalScale 3, SliderInput — 1..2): Mantine отдаёт
    // незавершённое "6." строкой, коммитить её нельзя, но готовое 6.75 должно уехать.
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInput({ value: 6, onChange, min: 0, max: 100, step: 0.1, decimalScale: 3 })

    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.tripleClick(input)
    await user.keyboard('6.')

    expect(onChange).not.toHaveBeenCalledWith('6.')
    expect(input.value).toBe('6.')

    await user.keyboard('75')
    expect(onChange).toHaveBeenLastCalledWith(6.75)

    // blur не портит дробное значение клампом (диапазон 0..100) и не режет знаки
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(6.75)
  })

  it('ввод сверх max клампится на blur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInput({ value: null, onChange, max: 10_000_000, allowEmpty: true })

    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.click(input)
    await user.type(input, '12345678901')
    await user.tab()

    expect(onChange).toHaveBeenLastCalledWith(10_000_000)
  })

  it('commitMode="blur": промежуточные валидные числа не коммитятся во время набора', async () => {
    // Регрессия: с commitMode="live" (по умолчанию) перенабор цены "7 000 000" →
    // "7 500 000" коммитит каждую промежуточную цифру ("7", "75", …), из-за чего relinkLoan
    // в MortgageForm пересчитывает долю взноса на огрызках и итог «уезжает».
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInput({ value: 7_000_000, onChange, min: 0, commitMode: 'blur', thousandSeparator: ' ' })

    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.tripleClick(input)
    await user.keyboard('7500000')

    expect(input.value.replace(/\s/g, '')).toBe('7500000') // поле показывает набор
    expect(onChange).not.toHaveBeenCalled() // но наружу ничего не коммитится вживую

    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(7_500_000) // коммит только на blur
  })

  it('commitMode="blur": Enter коммитит значение без потери фокуса на blur-эффекты', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderInput({ value: 7_000_000, onChange, min: 0, commitMode: 'blur', thousandSeparator: ' ' })

    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.tripleClick(input)
    await user.keyboard('7500000')
    expect(onChange).not.toHaveBeenCalled()

    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(7_500_000)
  })
})
