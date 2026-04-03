import { Tooltip, ActionIcon } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'

interface InfoTooltipProps {
  text: string
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <Tooltip label={text} multiline w={280} withArrow>
      <ActionIcon variant="transparent" color="gray" size="xs" style={{ cursor: 'help' }}>
        <IconInfoCircle size={14} />
      </ActionIcon>
    </Tooltip>
  )
}
